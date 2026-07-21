import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProfile, run as runFirefox } from "../../node_modules/web-ext/lib/firefox/index.js";
import { connectWithMaxRetries } from "../../node_modules/web-ext/lib/firefox/remote.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HARNESS = path.join(ROOT, "scripts/easyprivacy/firefox-benchmark");
const OUTPUT = path.join(HARNESS, ".output/firefox-mv3");
const FIREFOX_BINARY = process.env.FIREFOX_BINARY ?? "/Applications/Firefox.app/Contents/MacOS/firefox";
async function main() {
await access(FIREFOX_BINARY);
await runCommand("npx", ["wxt", "build", HARNESS, "-b", "firefox"]);
const controlServer = await startControlServer();
const controlUrl = `http://127.0.0.1:${controlServer.address().port}/`;

const profile = await createProfile({ customPrefs: {
  "app.update.disabledForTesting": true,
  "browser.safebrowsing.downloads.enabled": false,
  "browser.safebrowsing.malware.enabled": false,
  "browser.safebrowsing.phishing.enabled": false,
  "datareporting.healthreport.uploadEnabled": false,
  "network.captive-portal-service.enabled": false,
  "network.connectivity-service.enabled": false,
  "toolkit.telemetry.enabled": false,
} });
const running = await runFirefox(profile, {
  firefoxBinary: FIREFOX_BINARY,
  binaryArgs: ["-headless", "--url", controlUrl],
  extensions: [{ sourceDir: OUTPUT }],
  devtools: false,
});
let remote;
try {
  remote = await connectWithMaxRetries({ port: running.debuggerPort, maxRetries: 200, retryInterval: 100 });
  await remote.installTemporaryAddon(OUTPUT, false);
  const addons = (await remote.client.request("listAddons")).addons ?? [];
  const addon = addons.find(({ id }) => id === "trackerblocker-easyprivacy-performance@example.local");
  assert(addon);
  let tabs = [];
  let tab;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    tabs = (await remote.client.request("listTabs")).tabs ?? [];
    tab = tabs.find(({ url }) => url === controlUrl);
    if (tab) break;
    await delay(25);
  }
  assert(tab, `Benchmark control tab was not found: ${JSON.stringify(tabs.map(({ url, title }) => ({ url, title })))}`);
  const pageUrl = new URL("benchmark.html", addon.manifestURL).href;
  try {
    await remote.client.request({ to: tab.actor, type: "navigateTo", url: pageUrl, waitForLoad: true });
  } catch (error) {
    if (error?.error !== "tabDestroyed") throw error;
  }
  let benchmarkTab;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    benchmarkTab = ((await remote.client.request("listTabs")).tabs ?? [])
      .find(({ url }) => url === pageUrl);
    if (benchmarkTab) break;
    await delay(25);
  }
  assert(benchmarkTab);
  const protocol = new Evaluator(remote.client);
  let result;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    result = await protocol.json(benchmarkTab, `({ complete: document.documentElement.dataset.complete === "true", result: document.querySelector("#result")?.textContent })`);
    if (result.complete) break;
    await delay(50);
  }
  assert(result?.complete, "Firefox performance benchmark did not finish.");
  const values = JSON.parse(result.result);
  const initializationP95 = percentile(values.initializationMs, 0.95);
  const matchP95 = percentile(values.matchSamples, 0.95);
  assert.equal(values.initializationMs.length, 20);
  assert.equal(values.repetitions, 50_000);
  assert(initializationP95 < 100, `Initialization p95 ${initializationP95} ms exceeded 100 ms.`);
  assert(matchP95 < 1, `Match p95 ${matchP95} ms exceeded 1 ms.`);
  const metadata = JSON.parse(await readFile(path.join(ROOT, "public/filter-data/easyprivacy.metadata.json"), "utf8"));
  process.stdout.write("\nEasyPrivacy Firefox performance report\n");
  process.stdout.write(`Firefox binary: ${FIREFOX_BINARY}\n`);
  process.stdout.write(`Artifact SHA-256: ${metadata.artifactSha256}\n`);
  process.stdout.write(`Cold packaged initialization runs: ${values.initializationMs.length}\n`);
  process.stdout.write(`Initialization p95: ${initializationP95.toFixed(2)} ms\n`);
  process.stdout.write(`Normalized request + synchronous match p95: ${matchP95.toFixed(4)} ms\n`);
  process.stdout.write(`Representative matches: ${values.matches}/${values.repetitions}\n`);
  process.stdout.write(`Raw initialization samples: ${values.initializationMs.map((value) => value.toFixed(3)).join(", ")}\n`);
  process.stdout.write(`Raw per-match batch samples: ${values.matchSamples.map((value) => value.toFixed(6)).join(", ")}\n`);
} finally {
  remote?.disconnect();
  if (running.firefox.exitCode === null) {
    const closed = new Promise((resolve) => running.firefox.once("close", resolve));
    running.firefox.kill();
    await closed;
  }
  await new Promise((resolve) => controlServer.close(resolve));
}
}

class Evaluator {
  constructor(client) {
    this.client = client;
    this.pending = new Map();
    this.buffered = new Map();
    const original = client._handleMessage.bind(client);
    client._handleMessage = (message) => {
      if (message.type !== "evaluationResult") return original(message);
      const pending = this.pending.get(message.resultID);
      if (pending) { this.pending.delete(message.resultID); pending(message); }
      else this.buffered.set(message.resultID, message);
    };
  }
  async json(tab, expression) {
    const target = await this.client.request({ to: tab.actor, type: "getTarget" });
    const started = await this.client.request({ to: target.frame.consoleActor, type: "evaluateJSAsync", text: `JSON.stringify(${expression})`, mapped: { await: true } });
    const result = await this.wait(started.resultID);
    if (result.hasException) throw new Error(result.exceptionMessage);
    let value = result.result && typeof result.result === "object" && "value" in result.result
      ? result.result.value
      : result.result;
    if (result.result?.type === "longString") value = (await this.client.request({ to: result.result.actor, type: "substring", start: 0, end: result.result.length })).substring;
    return JSON.parse(value);
  }
  wait(id) {
    const buffered = this.buffered.get(id);
    if (buffered) { this.buffered.delete(id); return Promise.resolve(buffered); }
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function startControlServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>benchmark-control</title>");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

await main();
