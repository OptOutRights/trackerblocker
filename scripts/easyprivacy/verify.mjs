import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FiltersEngine } from "@ghostery/adblocker";

import {
  PROJECT_ROOT,
  buildEasyPrivacyOutputs,
  createRequest,
  readCommittedInputs,
  readGeneratedOutputs,
} from "./lib.mjs";

if (process.argv.length !== 2) {
  throw new Error("verify:easyprivacy does not accept arguments.");
}

const [{ source, sourceManifest }, committed, packageJsonText, packageLockText] =
  await Promise.all([
    readCommittedInputs(),
    readGeneratedOutputs(),
    readFile(`${PROJECT_ROOT}/package.json`, "utf8"),
    readFile(`${PROJECT_ROOT}/package-lock.json`, "utf8"),
  ]);
const rebuilt = await buildEasyPrivacyOutputs(source, sourceManifest);
const packageJson = JSON.parse(packageJsonText);
const packageLock = JSON.parse(packageLockText);

assert.equal(
  packageJson.devDependencies?.["@ghostery/adblocker"],
  rebuilt.metadata.ghosteryPackageVersion,
  "Ghostery must remain exactly pinned in package.json.",
);
assert.equal(
  packageLock.packages?.["node_modules/@ghostery/adblocker"]?.version,
  rebuilt.metadata.ghosteryPackageVersion,
  "Ghostery metadata and package-lock.json must agree.",
);
assert.ok(
  committed.artifact.equals(rebuilt.artifact),
  "Committed EasyPrivacy engine is stale or non-deterministic.",
);
assert.equal(
  committed.metadataText,
  rebuilt.metadataText,
  "Committed EasyPrivacy metadata is stale or non-deterministic.",
);
assert.equal(
  committed.capabilitiesText,
  rebuilt.capabilitiesText,
  "Committed EasyPrivacy capability report is stale or non-deterministic.",
);

const engine = FiltersEngine.deserialize(committed.artifact);

assert.equal(
  engine.getFilters().networkFilters.length,
  committed.metadata.ruleCounts.packagedNetworkRules,
);

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
      sourceSha256: rebuilt.metadata.sourceSha256,
      artifactSha256: rebuilt.metadata.artifactSha256,
      packagedNetworkRules: rebuilt.metadata.ruleCounts.packagedNetworkRules,
      byteIdenticalRebuild: true,
      representativeMatchesVerified: 4,
    },
    null,
    2,
  ),
);
