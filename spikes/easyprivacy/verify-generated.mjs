import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FiltersEngine } from "@ghostery/adblocker";

import { createRequest } from "./spike-lib.mjs";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(SPIKE_DIR, "fixtures/easyprivacy.txt");
const ARTIFACT_PATH = resolve(
  SPIKE_DIR,
  "wxt/public/filter-data/easyprivacy.engine",
);
const METADATA_PATH = resolve(
  SPIKE_DIR,
  "wxt/public/filter-data/easyprivacy.metadata.json",
);
const [source, artifact, metadataText] = await Promise.all([
  readFile(SOURCE_PATH),
  readFile(ARTIFACT_PATH),
  readFile(METADATA_PATH, "utf8"),
]);
const metadata = JSON.parse(metadataText);
const engine = FiltersEngine.deserialize(artifact);

assert.equal(sha256(source), metadata.sourceSha256);
assert.equal(sha256(artifact), metadata.artifactSha256);
assert.equal(
  engine.getFilters().networkFilters.length,
  metadata.packagedNetworkRules,
);
assert.equal(metadata.ghosteryPackageVersion, "2.18.1");
assert.equal(metadata.deterministicSerialization, true);
assert.equal(metadata.deserializeSerializeRoundTrip, true);

for (const details of [
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
]) {
  assert.equal(engine.match(createRequest(details)).match, true);
}

assert.equal(
  engine.match(
    createRequest({
      url: "https://publisher.test/assets/app.js",
      sourceUrl: "https://publisher.test/",
      type: "script",
    }),
  ).match,
  false,
);

console.log(
  JSON.stringify(
    {
      sourceSha256: metadata.sourceSha256,
      artifactSha256: metadata.artifactSha256,
      packagedNetworkRules: metadata.packagedNetworkRules,
      representativeMatchesVerified: 4,
    },
    null,
    2,
  ),
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
