import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { FiltersEngine } from "@ghostery/adblocker";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(
  SPIKE_DIR,
  "wxt/public/filter-data/easyprivacy.engine",
);
const readStartedAt = performance.now();
const artifact = await readFile(artifactPath);
const readCompletedAt = performance.now();
const engine = FiltersEngine.deserialize(artifact);
const readyAt = performance.now();

console.log(
  JSON.stringify({
    artifactReadMs: readCompletedAt - readStartedAt,
    deserializeMs: readyAt - readCompletedAt,
    processToReadyMs: readyAt,
    ruleCount: engine.getFilters().networkFilters.length,
  }),
);
