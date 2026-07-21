import assert from "node:assert/strict";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProfile,
  run as runFirefox,
} from "../../node_modules/web-ext/lib/firefox/index.js";
import { connectWithMaxRetries } from "../../node_modules/web-ext/lib/firefox/remote.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIREFOX_BINARY =
  process.env.FIREFOX_BINARY ??
  "/Applications/Firefox.app/Contents/MacOS/firefox";
const EXTENSION_ID = "trackerblocker@example.local";
const GET_SUMMARY = "trackerblocker.getTabRequestSummary";
const HEALTH = "trackerblocker.healthCheck";
const sites = [
  site("Reuters", "news/content", "https://www.reuters.com/world/"),
  site("BBC", "news/content", "https://www.bbc.com/news"),
  site("eBay", "commerce", "https://www.ebay.com/"),
  site("IKEA", "commerce", "https://www.ikea.com/us/en/"),
  site("GitHub sign-in", "login/account", "https://github.com/login", /sign in/i),
  site("GitLab sign-in", "login/account", "https://gitlab.com/users/sign_in", /sign in/i),
  site("YouTube", "video/media", "https://www.youtube.com/"),
  site("Vimeo", "video/media", "https://vimeo.com/watch"),
  site("Stripe Checkout docs", "payment/demo", "https://docs.stripe.com/payments/checkout", /checkout/i),
  site("PayPal Checkout demo", "payment/demo", "https://developer.paypal.com/demo/checkout/", /checkout/i),
  site("Reddit", "social/public", "https://www.reddit.com/"),
  site("Bluesky", "social/public", "https://bsky.app/"),
  site("Example Domain", "quiet first-party", "https://example.com/", /example domain/i),
  site("W3C Cool URIs", "quiet first-party", "https://www.w3.org/Provider/Style/URI", /cool uris/i),
];

let buildRoot;

async function main() {
  buildRoot = await mkdtemp(path.join(os.tmpdir(), "trackerblocker-site-study-"));
  const builds = {
  catalog: await buildAndCopy("catalog", false),
  easyprivacy: await buildAndCopy("easyprivacy", true),
};
const results = {};
for (const [mode, sourceDir] of Object.entries(builds)) {
  results[mode] = await runMode(mode, sourceDir);
}

const comparisons = sites.map(({ name, category }) => {
  const catalog = results.catalog.find((result) => result.name === name);
  const easyprivacy = results.easyprivacy.find((result) => result.name === name);
  assert(catalog && easyprivacy);
  return {
    name,
    category,
    catalog,
    easyprivacy,
    incrementalBlocks:
      easyprivacy.blockedRequests - catalog.blockedRequests,
    incrementalHosts: easyprivacy.blockedHosts - catalog.blockedHosts,
  };
});

const regressions = comparisons.filter(
  ({ catalog, easyprivacy }) => catalog.taskPassed && !easyprivacy.taskPassed,
);
const quietFirstPartyBlocks = comparisons.filter(
  ({ category, easyprivacy }) =>
    category === "quiet first-party" && easyprivacy.firstPartyBlockedRequests > 0,
);
const activeCategoriesWithIncrementalCoverage = new Set(
  comparisons
    .filter(
      ({ category, incrementalBlocks }) =>
        category !== "quiet first-party" && incrementalBlocks > 0,
    )
    .map(({ category }) => category),
);

process.stdout.write("\nEasyPrivacy paired real-site study\n");
process.stdout.write(`Date: ${new Date().toISOString()}\n`);
process.stdout.write(`Firefox: ${FIREFOX_BINARY}\n`);
process.stdout.write(
  "site\tcategory\tcatalog task/blocked requests/hosts\teasyprivacy task/blocked requests/hosts\tdelta requests/hosts\n",
);
for (const comparison of comparisons) {
  const { catalog, easyprivacy } = comparison;
  process.stdout.write(
    `${comparison.name}\t${comparison.category}\t${status(catalog)}/${catalog.blockedRequests}/${catalog.blockedHosts}\t${status(easyprivacy)}/${easyprivacy.blockedRequests}/${easyprivacy.blockedHosts}\t${comparison.incrementalBlocks}/${comparison.incrementalHosts}\n`,
  );
}
process.stdout.write(
  `Network-active categories with incremental coverage: ${activeCategoriesWithIncrementalCoverage.size}/6\n`,
);
process.stdout.write(`EasyPrivacy-only task regressions: ${regressions.length}\n`);
process.stdout.write(
  `Quiet-site first-party cancellations: ${quietFirstPartyBlocks.length}\n`,
);

assert.deepEqual(regressions, []);
assert.deepEqual(quietFirstPartyBlocks, []);
assert(
  activeCategoriesWithIncrementalCoverage.size >= 4,
  "Expected incremental EasyPrivacy blocks in at least four active categories.",
);
}

async function buildAndCopy(name, enabled) {
  await runCommand("npx", ["wxt", "build", "-b", "firefox"], {
    ...process.env,
    WXT_EASYPRIVACY_MATCHING: enabled ? "true" : "false",
  });
  const destination = path.join(buildRoot, name);
  await cp(path.join(ROOT, ".output/firefox-mv3"), destination, {
    recursive: true,
  });
  return destination;
}

async function runMode(mode, sourceDir) {
  const profile = await createProfile({ customPrefs: qaPreferences() });
  const running = await runFirefox(profile, {
    firefoxBinary: FIREFOX_BINARY,
    binaryArgs: ["-headless", "--url", "about:blank"],
    extensions: [{ sourceDir }],
    devtools: false,
  });
  let remote;
  try {
    remote = await connectWithMaxRetries({
      port: running.debuggerPort,
      maxRetries: 200,
      retryInterval: 100,
    });
    await remote.installTemporaryAddon(sourceDir, false);
    const addon = await findAddon(remote);
    const protocol = new FirefoxProtocol(remote.client);
    const tabs = (await remote.client.request("listTabs")).tabs ?? [];
    const control = tabs.find(({ url }) => url === "about:blank");
    assert(control);
    await protocol.navigate(control, new URL("options.html", addon.manifestURL).href);
    const health = await waitForHealth(protocol, control);
    assert.equal(health.easyPrivacy.matchingEnabled, mode === "easyprivacy");
    assert.equal(health.easyPrivacy.engineHealth, "ready");

    const modeResults = [];
    for (const definition of sites) {
      modeResults.push(
        await inspectSite({ definition, protocol, control, remote }),
      );
    }
    return modeResults;
  } finally {
    remote?.disconnect();
    if (running.firefox.exitCode === null) {
      const closed = new Promise((resolve) => running.firefox.once("close", resolve));
      running.firefox.kill();
      await closed;
    }
  }
}

async function inspectSite({ definition, protocol, control, remote }) {
  let browserTab;
  try {
    browserTab = await protocol.evaluateJson(
      control,
      `browser.tabs.create({ active: false, url: ${JSON.stringify(definition.url)} })`,
    );
    const loaded = await waitForLoadedTab(protocol, control, browserTab.id);
    const rdpTab = await waitForRdpTab(remote, loaded.url);
    await delay(1_500);
    const page = await protocol.evaluateJson(rdpTab, `({
      bodyText: document.body?.innerText?.slice(0, 5000) ?? "",
      title: document.title,
    })`);
    const taskPassed =
      page.bodyText.trim().length >= 80 &&
      (!definition.expectedText || definition.expectedText.test(page.bodyText));
    const summary = await protocol.evaluateJson(
      control,
      `browser.runtime.sendMessage(${JSON.stringify({
        type: GET_SUMMARY,
        tabId: browserTab.id,
        pageUrl: loaded.url,
      })})`,
    );
    return {
      name: definition.name,
      taskPassed,
      blockedRequests: summary.requestCounts.blocked,
      blockedHosts: summary.hostCounts.blocked,
      firstPartyBlockedRequests: summary.rows
        .filter(({ relationship }) => relationship === "first-party")
        .reduce((total, row) => total + row.actionCounts.blocked, 0),
    };
  } catch (error) {
    return {
      name: definition.name,
      taskPassed: false,
      blockedRequests: 0,
      blockedHosts: 0,
      firstPartyBlockedRequests: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (browserTab?.id) {
      await protocol
        .evaluateJson(control, `(await browser.tabs.remove(${browserTab.id}), true)`)
        .catch(() => undefined);
    }
  }
}

async function waitForLoadedTab(protocol, control, tabId) {
  let tab;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    tab = await protocol.evaluateJson(control, `browser.tabs.get(${tabId})`);
    if (tab.status === "complete" && /^https?:/.test(tab.url)) return tab;
    await delay(125);
  }
  throw new Error(`Public site tab ${tabId} did not finish loading.`);
}

async function waitForRdpTab(remote, url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const tabs = (await remote.client.request("listTabs")).tabs ?? [];
    const tab = tabs.find((candidate) => candidate.url === url);
    if (tab) return tab;
    await delay(100);
  }
  throw new Error("Could not attach to the public site tab.");
}

async function waitForHealth(protocol, tab) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const health = await protocol.evaluateJson(
        tab,
        `browser.runtime.sendMessage({ type: ${JSON.stringify(HEALTH)} })`,
      );
      if (health.easyPrivacy.engineHealth !== "loading") return health;
    } catch {
      // The extension worker may still be starting.
    }
    await delay(50);
  }
  throw new Error("Extension health did not become available.");
}

async function findAddon(remote) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const addons = (await remote.client.request("listAddons")).addons ?? [];
    const addon = addons.find(({ id }) => id === EXTENSION_ID);
    if (addon) return addon;
    await delay(50);
  }
  throw new Error("TrackerBlocker add-on actor was not found.");
}

class FirefoxProtocol {
  constructor(client) {
    this.client = client;
    this.buffered = new Map();
    this.pending = new Map();
    const original = client._handleMessage.bind(client);
    client._handleMessage = (message) => {
      if (message.type !== "evaluationResult") return original(message);
      const pending = this.pending.get(message.resultID);
      if (pending) {
        this.pending.delete(message.resultID);
        pending.resolve(message);
      } else {
        this.buffered.set(message.resultID, message);
      }
    };
  }

  async navigate(tab, url) {
    await withTimeout(
      this.client.request({ to: tab.actor, type: "navigateTo", url, waitForLoad: true }),
      15_000,
      "Firefox control-tab navigation timed out.",
    );
  }

  async evaluateJson(tab, expression) {
    const value = await this.evaluate(tab, `(async () => JSON.stringify(await (${expression})))()`);
    if (typeof value !== "string") throw new Error("Firefox returned non-JSON evaluation data.");
    return JSON.parse(value);
  }

  async evaluate(tab, text) {
    const target = await this.client.request({ to: tab.actor, type: "getTarget" });
    const started = await this.client.request({
      to: target.frame.consoleActor,
      type: "evaluateJSAsync",
      text,
      mapped: { await: true },
    });
    const result = await this.waitForEvaluation(started.resultID);
    if (result.hasException) throw new Error(result.exceptionMessage ?? "Firefox evaluation failed.");
    if (result.result?.type === "longString") {
      const response = await this.client.request({
        to: result.result.actor,
        type: "substring",
        start: 0,
        end: result.result.length,
      });
      return response.substring;
    }
    return result.result && typeof result.result === "object" && "value" in result.result
      ? result.result.value
      : result.result;
  }

  waitForEvaluation(resultID) {
    const buffered = this.buffered.get(resultID);
    if (buffered) {
      this.buffered.delete(resultID);
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(resultID);
        reject(new Error("Firefox evaluation timed out."));
      }, 15_000);
      this.pending.set(resultID, {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
      });
    });
  }
}

function qaPreferences() {
  return {
    "app.update.disabledForTesting": true,
    "browser.safebrowsing.downloads.enabled": false,
    "browser.safebrowsing.malware.enabled": false,
    "browser.safebrowsing.phishing.enabled": false,
    "datareporting.healthreport.uploadEnabled": false,
    "extensions.getAddons.cache.enabled": false,
    "network.captive-portal-service.enabled": false,
    "network.connectivity-service.enabled": false,
    "toolkit.telemetry.enabled": false,
    "toolkit.telemetry.unified": false,
  };
}

function site(name, category, url, expectedText = null) {
  return { name, category, url, expectedText };
}

function status(result) {
  return result.taskPassed ? "pass" : `fail${result.error ? ` (${result.error})` : ""}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
  ]);
}

async function runCommand(command, args, env) {
  const { spawn } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)),
    );
  });
}

// Keep the retained artifact revision visible in command output without exposing
// any browsing data collected during the study.
await main();
const metadata = JSON.parse(
  await readFile(path.join(ROOT, "public/filter-data/easyprivacy.metadata.json"), "utf8"),
);
process.stdout.write(`EasyPrivacy revision: ${metadata.upstreamVersion}\n`);
