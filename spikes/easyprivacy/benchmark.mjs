import { execFile } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FiltersEngine } from "@ghostery/adblocker";

import { createRequest } from "./spike-lib.mjs";

const execFileAsync = promisify(execFile);
const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(
  SPIKE_DIR,
  "wxt/public/filter-data/easyprivacy.engine",
);
const WORKER_PATH = resolve(SPIKE_DIR, "benchmark-worker.mjs");
const OUTPUT_PATH = resolve(SPIKE_DIR, "benchmark-results.json");
const COLD_RUNS = 20;
const MATCH_RUNS = 50_000;
const coldRuns = [];

for (let index = 0; index < COLD_RUNS; index += 1) {
  const { stdout } = await execFileAsync(process.execPath, [WORKER_PATH]);
  coldRuns.push(JSON.parse(stdout));
}

const artifact = await readFile(ARTIFACT_PATH);
const engine = FiltersEngine.deserialize(artifact);
const requestDetails = [
  {
    url: "https://www.google-analytics.com/g/collect?v=2&tid=G-TEST",
    sourceUrl: "https://publisher.test/",
    type: "xmlhttprequest",
  },
  {
    url: "https://connect.facebook.net/en_US/fbevents.js",
    sourceUrl: "https://publisher.test/",
    type: "script",
  },
  {
    url: "https://bat.bing.com/action/0?ti=1",
    sourceUrl: "https://publisher.test/",
    type: "image",
  },
  {
    url: "https://publisher.test/assets/app.js",
    sourceUrl: "https://publisher.test/",
    type: "script",
  },
  {
    url: "https://example-cdn.test/assets/app.css",
    sourceUrl: "https://publisher.test/",
    type: "stylesheet",
  },
  {
    url: "wss://publisher.test/socket",
    sourceUrl: "https://publisher.test/",
    type: "websocket",
  },
];
const requests = requestDetails.map(createRequest);

for (let index = 0; index < 2_000; index += 1) {
  engine.match(requests[index % requests.length]);
}

const engineMatchDurationsMs = [];
let cachedRequestMatches = 0;

for (let index = 0; index < MATCH_RUNS; index += 1) {
  const request = requests[index % requests.length];
  const startedAt = process.hrtime.bigint();
  const result = engine.match(request);
  const completedAt = process.hrtime.bigint();
  engineMatchDurationsMs.push(Number(completedAt - startedAt) / 1_000_000);
  cachedRequestMatches += result.match ? 1 : 0;
}

const endToEndDurationsMs = [];
let endToEndMatches = 0;
const endToEndStartedAt = process.hrtime.bigint();

for (let index = 0; index < MATCH_RUNS; index += 1) {
  const details = requestDetails[index % requestDetails.length];
  const separator = details.url.includes("?") ? "&" : "?";
  const startedAt = process.hrtime.bigint();
  const request = createRequest({
    ...details,
    requestId: `benchmark-${index}`,
    url: `${details.url}${separator}sample=${index}`,
  });
  const result = engine.match(request);
  const completedAt = process.hrtime.bigint();
  endToEndDurationsMs.push(Number(completedAt - startedAt) / 1_000_000);
  endToEndMatches += result.match ? 1 : 0;
}

const endToEndCompletedAt = process.hrtime.bigint();
const totalEndToEndDurationMs =
  Number(endToEndCompletedAt - endToEndStartedAt) / 1_000_000;
const results = {
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  coldInitialization: {
    runs: COLD_RUNS,
    artifactReadMs: summarize(coldRuns.map((run) => run.artifactReadMs)),
    deserializeMs: summarize(coldRuns.map((run) => run.deserializeMs)),
    processToReadyMs: summarize(coldRuns.map((run) => run.processToReadyMs)),
  },
  matching: {
    runs: MATCH_RUNS,
    fixtures: requests.length,
    cachedRequestMatches,
    engineMatchOnlyLatencyMs: summarize(engineMatchDurationsMs),
    endToEndMatches,
    endToEndTotalDurationMs: round(totalEndToEndDurationMs),
    endToEndThroughputPerSecond: round(
      MATCH_RUNS / (totalEndToEndDurationMs / 1000),
    ),
    requestCreationAndMatchLatencyMs: summarize(endToEndDurationsMs),
  },
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(JSON.stringify(results, null, 2));

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    min: round(sorted[0]),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1)),
    mean: round(total / sorted.length),
  };
}

function percentile(sorted, quantile) {
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  ];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
