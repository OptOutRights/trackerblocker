import { readFile } from "node:fs/promises";

import {
  ARTIFACT_PATH,
  CAPABILITIES_PATH,
  MAX_SOURCE_BYTES,
  METADATA_PATH,
  SOURCE_MANIFEST_PATH,
  SOURCE_PATH,
  SOURCE_URL,
  buildEasyPrivacyOutputs,
  createUpdateSummary,
  createUpdatedSourceManifest,
  publishFiles,
  stableJson,
} from "./lib.mjs";

if (process.argv.length !== 2) {
  throw new Error("update:easyprivacy does not accept arguments.");
}

const previousMetadata = await readJsonIfPresent(METADATA_PATH);
const previousCapabilities = await readJsonIfPresent(CAPABILITIES_PATH);
const previousSourceManifest = await readJsonIfPresent(SOURCE_MANIFEST_PATH);
const response = await fetch(SOURCE_URL, { redirect: "follow" });

if (!response.ok) {
  throw new Error(`EasyPrivacy download failed with HTTP ${response.status}.`);
}

if (response.url !== SOURCE_URL) {
  throw new Error(`EasyPrivacy download redirected to ${response.url}.`);
}

const contentType = response.headers.get("content-type");

if (!contentType?.toLowerCase().startsWith("text/plain")) {
  throw new Error(`EasyPrivacy returned unexpected content type ${contentType}.`);
}

const contentLength = Number(response.headers.get("content-length"));

if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
  throw new Error("EasyPrivacy response exceeds the maintained size limit.");
}

const source = await readBoundedResponse(response);
const sourceManifest = createUpdatedSourceManifest(
  source,
  new Date().toISOString(),
  previousSourceManifest,
);
const outputs = await buildEasyPrivacyOutputs(source, sourceManifest);

await publishFiles([
  [SOURCE_PATH, source],
  [SOURCE_MANIFEST_PATH, stableJson(sourceManifest)],
  [ARTIFACT_PATH, outputs.artifact],
  [METADATA_PATH, outputs.metadataText],
  [CAPABILITIES_PATH, outputs.capabilitiesText],
]);

console.log(
  JSON.stringify(
    createUpdateSummary(
      previousMetadata,
      previousCapabilities,
      outputs.metadata,
      outputs.capabilities,
    ),
    null,
    2,
  ),
);

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readBoundedResponse(response) {
  if (!response.body) {
    throw new Error("EasyPrivacy response had no body.");
  }

  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    totalBytes += bytes.byteLength;

    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new Error("EasyPrivacy response exceeds the maintained size limit.");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks, totalBytes);
}
