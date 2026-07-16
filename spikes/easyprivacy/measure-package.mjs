import { stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const TARGET_BYTES = 1_500_000;
const baselinePath = resolve(
  SPIKE_DIR,
  "wxt-baseline/.output/trackerblocker-easyprivacy-spike-baseline-0.0.0-firefox.zip",
);
const candidatePath = resolve(
  SPIKE_DIR,
  "wxt/.output/trackerblocker-easyprivacy-spike-0.0.0-firefox.zip",
);
const outputPath = resolve(SPIKE_DIR, "package-results.json");
const baselineZipBytes = (await stat(baselinePath)).size;
const candidateZipBytes = (await stat(candidatePath)).size;
const addedZipBytes = candidateZipBytes - baselineZipBytes;
const results = {
  baselineZipBytes,
  candidateZipBytes,
  addedZipBytes,
  targetBytes: TARGET_BYTES,
  marginBytes: TARGET_BYTES - addedZipBytes,
  passes: addedZipBytes < TARGET_BYTES,
};

await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.log(JSON.stringify(results, null, 2));
