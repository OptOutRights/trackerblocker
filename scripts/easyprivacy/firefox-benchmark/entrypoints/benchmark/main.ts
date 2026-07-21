import { browser } from "wxt/browser";

import { FilterEngine } from "../../../../../src/shared/filterEngine";
import { normalizeRequestContext } from "../../../../../src/shared/requestDecisions";

const repetitions = 50_000;
const contexts = [
  ["https://publisher.test/", "https://screen13.com/pixel", "image"],
  ["https://publisher.test/", "https://firecrux.com/track/event", "xmlhttprequest"],
  ["https://abema.tv/", "https://bam.nr-data.net/1/events", "xmlhttprequest"],
  ["https://news.yahoo.com/", "https://s.yimg.com/aaq/vzm/tracker.js", "script"],
  ["https://example.test/", "https://s.yimg.com/aaq/vzm/tracker.js", "script"],
  ["https://search.brave.com/", "https://search.brave.com/api/feedback", "xmlhttprequest"],
  ["https://search.brave.com/", "https://search.brave.com/api/search", "xmlhttprequest"],
  ["https://publisher.test/", "wss://neowin.net/ws/socket", "websocket"],
  ["https://publisher.test/", "https://fixture.test/allowed.js", "script"],
] as const;

const initializationMs: number[] = [];
let engine: FilterEngine | null = null;
for (let index = 0; index < 20; index += 1) {
  const candidate = new FilterEngine();
  const started = performance.now();
  await candidate.initialize(loadPackagedArtifact);
  initializationMs.push(performance.now() - started);
  if (candidate.health !== "ready") {
    throw new Error(`Initialization ${index + 1} did not produce a ready engine.`);
  }
  engine = candidate;
}

if (!engine) throw new Error("The benchmark engine was not initialized.");
const matchSamples: number[] = [];
let matches = 0;
for (let batch = 0; batch < 50; batch += 1) {
  const started = performance.now();
  for (let offset = 0; offset < repetitions / 50; offset += 1) {
    const index = batch * (repetitions / 50) + offset;
    const [pageUrl, requestUrl, requestType] = contexts[index % contexts.length];
    const normalized = normalizeRequestContext({
      requestId: String(index),
      tabId: 1,
      pageUrl,
      requestUrl,
      requestType,
    });
    const outcome = engine.match({
      requestId: normalized.requestId,
      tabId: normalized.tabId,
      url: normalized.requestUrl,
      sourceUrl: normalized.sourceUrl,
      type: normalized.requestType,
    }).outcome;
    if (outcome === "block" || outcome === "exception") matches += 1;
  }
  matchSamples.push((performance.now() - started) / (repetitions / 50));
}

document.querySelector("#result")!.textContent = JSON.stringify({
  initializationMs,
  matchSamples,
  matches,
  repetitions,
});
document.documentElement.dataset.complete = "true";

async function loadPackagedArtifact() {
  const [artifactResponse, metadataResponse] = await Promise.all([
    fetch(browser.runtime.getURL("/filter-data/easyprivacy.engine"), {
      cache: "no-store",
    }),
    fetch(browser.runtime.getURL("/filter-data/easyprivacy.metadata.json"), {
      cache: "no-store",
    }),
  ]);
  if (!artifactResponse.ok || !metadataResponse.ok) {
    throw new Error("Packaged EasyPrivacy data is unavailable.");
  }
  return {
    artifact: new Uint8Array(await artifactResponse.arrayBuffer()),
    metadata: await metadataResponse.json(),
  };
}
