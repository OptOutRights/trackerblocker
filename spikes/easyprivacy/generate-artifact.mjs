import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FiltersEngine } from "@ghostery/adblocker";

import { compileSupportedNetworkEngine } from "./spike-lib.mjs";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_URL = "https://easylist.to/easylist/easyprivacy.txt";
const SOURCE_PATH = resolve(SPIKE_DIR, "fixtures/easyprivacy.txt");
const GENERATED_DIR = resolve(SPIKE_DIR, "wxt/public/filter-data");
const ARTIFACT_PATH = resolve(GENERATED_DIR, "easyprivacy.engine");
const METADATA_PATH = resolve(GENERATED_DIR, "easyprivacy.metadata.json");
const CAPABILITIES_PATH = resolve(SPIKE_DIR, "capabilities.json");
const shouldUpdateSource = process.argv.includes("--update-source");

await mkdir(dirname(SOURCE_PATH), { recursive: true });
await mkdir(GENERATED_DIR, { recursive: true });

let source;
let retrievedAt = null;

if (shouldUpdateSource) {
  const response = await fetch(SOURCE_URL, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`EasyPrivacy download failed with HTTP ${response.status}.`);
  }

  source = await response.text();
  validateEasyPrivacySource(source);
  await writeFile(SOURCE_PATH, source, "utf8");
  retrievedAt = new Date().toISOString();
} else {
  source = await readRetainedSource();
  validateEasyPrivacySource(source);
  retrievedAt = await readExistingRetrievalTime();
}

const packageJson = JSON.parse(
  await readFile(resolve(SPIKE_DIR, "../../node_modules/@ghostery/adblocker/package.json"), "utf8"),
);
const { engine, report } = compileSupportedNetworkEngine(source);
const artifact = engine.serialize();
const secondArtifact = engine.serialize();

if (!Buffer.from(artifact).equals(Buffer.from(secondArtifact))) {
  throw new Error("Serializing the same engine twice was not deterministic.");
}

const restoredArtifact = FiltersEngine.deserialize(artifact).serialize();

if (!Buffer.from(artifact).equals(Buffer.from(restoredArtifact))) {
  throw new Error("The artifact changed after a deserialize/serialize round trip.");
}

const header = readEasyPrivacyHeader(source);
const metadata = {
  sourceUrl: SOURCE_URL,
  retrievedAt,
  upstreamVersion: header.version,
  upstreamLastModified: header.lastModified,
  upstreamCommit: header.commit,
  sourceSha256: sha256(source),
  sourceBytes: Buffer.byteLength(source),
  generator: "spikes/easyprivacy/generate-artifact.mjs",
  ghosteryPackageVersion: packageJson.version,
  engineConfiguration: engine.config,
  artifactSha256: sha256(artifact),
  artifactBytes: artifact.byteLength,
  deterministicSerialization: true,
  deserializeSerializeRoundTrip: true,
  ...report,
};

await writeFile(ARTIFACT_PATH, artifact);
await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
await writeFile(CAPABILITIES_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify(metadata, null, 2));

function validateEasyPrivacySource(value) {
  if (!value.startsWith("[Adblock Plus") || !value.includes("! Title: EasyPrivacy")) {
    throw new Error("Downloaded input does not look like the assembled EasyPrivacy list.");
  }

  if (value.length < 100_000) {
    throw new Error("Downloaded EasyPrivacy input is unexpectedly small.");
  }
}

function readEasyPrivacyHeader(value) {
  const header = value.split("\n").slice(0, 30).join("\n");

  return {
    version: readHeaderValue(header, "Version"),
    lastModified: readHeaderValue(header, "Last modified"),
    commit: readHeaderValue(header, "Commit"),
  };
}

function readHeaderValue(header, name) {
  return header.match(new RegExp(`^! ${name}: (.+)$`, "m"))?.[1] ?? null;
}

async function readExistingRetrievalTime() {
  try {
    const existing = JSON.parse(await readFile(METADATA_PATH, "utf8"));
    return typeof existing.retrievedAt === "string" ? existing.retrievedAt : null;
  } catch {
    return null;
  }
}

async function readRetainedSource() {
  try {
    return await readFile(SOURCE_PATH, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "EasyPrivacy source is not present. Run `npm run spike:easyprivacy:update` for the explicit networked update step.",
      );
    }

    throw error;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
