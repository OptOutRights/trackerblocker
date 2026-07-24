import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FiltersEngine,
  Request,
  parseFilters,
} from "@ghostery/adblocker";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
export const SOURCE_URL = "https://easylist.to/easylist/easyprivacy.txt";
export const SOURCE_PATH = resolve(
  PROJECT_ROOT,
  "vendor/easyprivacy/easyprivacy.txt",
);
export const SOURCE_MANIFEST_PATH = resolve(
  PROJECT_ROOT,
  "vendor/easyprivacy/source.json",
);
export const ARTIFACT_PATH = resolve(
  PROJECT_ROOT,
  "public/filter-data/easyprivacy.engine",
);
export const METADATA_PATH = resolve(
  PROJECT_ROOT,
  "public/filter-data/easyprivacy.metadata.json",
);
export const CAPABILITIES_PATH = resolve(
  PROJECT_ROOT,
  "vendor/easyprivacy/easyprivacy.capabilities.json",
);

export const ENGINE_CONFIG = Object.freeze({
  debug: false,
  enableCompression: true,
  enableHtmlFiltering: false,
  enableInMemoryCache: true,
  enableMutationObserver: false,
  enableOptimizations: true,
  enablePushInjectionsOnNavigationEvents: false,
  guessRequestTypeFromUrl: false,
  integrityCheck: true,
  loadCSPFilters: false,
  loadCosmeticFilters: false,
  loadExceptionFilters: true,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false,
  loadNetworkFilters: true,
  loadPreprocessors: false,
});

const INVENTORY_CONFIG = Object.freeze({
  ...ENGINE_CONFIG,
  enableHtmlFiltering: true,
  loadCSPFilters: true,
  loadCosmeticFilters: true,
  loadExtendedSelectors: true,
  loadGenericCosmeticsFilters: true,
  loadPreprocessors: true,
});
export const MAX_SOURCE_BYTES = 5_000_000;
const MIN_SOURCE_BYTES = 100_000;
const MIN_SOURCE_LINES = 10_000;
const MAX_SAMPLES_PER_CATEGORY = 20;

export function validateEasyPrivacySource(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

  if (Buffer.byteLength(text) !== bytes.byteLength) {
    throw new Error("EasyPrivacy source is not canonical UTF-8 text.");
  }

  if (bytes.byteLength < MIN_SOURCE_BYTES) {
    throw new Error("EasyPrivacy source is unexpectedly small.");
  }

  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("EasyPrivacy source exceeds the maintained size limit.");
  }

  if (!text.startsWith("[Adblock Plus 1.1]\n")) {
    throw new Error("EasyPrivacy source has an unexpected format header.");
  }

  const lineCount = countLines(text);

  if (lineCount < MIN_SOURCE_LINES) {
    throw new Error("EasyPrivacy source has unexpectedly few lines.");
  }

  const header = readEasyPrivacyHeader(text);

  if (header.title !== "EasyPrivacy") {
    throw new Error("EasyPrivacy source has an unexpected title.");
  }

  if (!/^\d{12}$/.test(header.version ?? "")) {
    throw new Error("EasyPrivacy source has an invalid version header.");
  }

  if (!header.lastModified) {
    throw new Error("EasyPrivacy source has no last-modified header.");
  }

  if (!/^[0-9a-f]{40}$/.test(header.commit ?? "")) {
    throw new Error("EasyPrivacy source has an invalid upstream commit.");
  }

  if (header.licence !== "https://easylist.to/pages/licence.html") {
    throw new Error("EasyPrivacy source has an unexpected licence declaration.");
  }

  return {
    bytes,
    text,
    lineCount,
    sourceSha256: sha256(bytes),
    header,
  };
}

export function createSourceManifest(source, retrievedAt) {
  const validated = validateEasyPrivacySource(source);
  const normalizedRetrievedAt = normalizeIsoDate(retrievedAt);

  return {
    schemaVersion: 1,
    sourceUrl: SOURCE_URL,
    retrievedAt: normalizedRetrievedAt,
    upstreamVersion: validated.header.version,
    upstreamLastModified: validated.header.lastModified,
    upstreamCommit: validated.header.commit,
    sourceSha256: validated.sourceSha256,
    sourceBytes: validated.bytes.byteLength,
    sourceLines: validated.lineCount,
  };
}

export function createUpdatedSourceManifest(
  source,
  retrievedAt,
  previousManifest,
) {
  const candidate = createSourceManifest(source, retrievedAt);

  if (previousManifest?.sourceSha256 !== candidate.sourceSha256) {
    return candidate;
  }

  validateSourceManifest(source, previousManifest);
  return createSourceManifest(source, previousManifest.retrievedAt);
}

export function validateSourceManifest(source, manifest) {
  const validated = validateEasyPrivacySource(source);

  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1) {
    throw new Error("EasyPrivacy source manifest has an unsupported schema.");
  }

  if (manifest.sourceUrl !== SOURCE_URL) {
    throw new Error("EasyPrivacy source manifest has an unexpected source URL.");
  }

  normalizeIsoDate(manifest.retrievedAt);

  const expected = createSourceManifest(validated.bytes, manifest.retrievedAt);

  for (const key of Object.keys(expected)) {
    if (manifest[key] !== expected[key]) {
      throw new Error(`EasyPrivacy source manifest field ${key} is stale.`);
    }
  }

  return validated;
}

export function classifyNetworkFilter(filter) {
  if (filter.isCSP()) {
    return "csp";
  }

  if (filter.isRedirectRule()) {
    return "redirect-rule";
  }

  if (filter.isRedirect()) {
    return "redirect";
  }

  if (filter.isRemoveParam()) {
    return "removeparam";
  }

  if (filter.isReplace() || filter.isHtmlFilteringRule()) {
    return "response-modification";
  }

  if (filter.isElemHide() || filter.isGenericHide() || filter.isSpecificHide()) {
    return "cosmetic-exception";
  }

  if (filter.optionValue !== undefined) {
    throw new Error(
      `Parsed network rule has an uninventoried action: ${filter.rawLine ?? filter.toString()}`,
    );
  }

  return filter.isException() ? "supported-exception" : "supported-block";
}

export function inventoryFilterList(list) {
  const parsed = parseFilters(list, INVENTORY_CONFIG);
  const debugParsed = parseFilters(list, {
    ...INVENTORY_CONFIG,
    debug: true,
  });

  if (parsed.networkFilters.length !== debugParsed.networkFilters.length) {
    throw new Error("Debug and production rule inventories disagree.");
  }

  const networkRuleCounts = {};
  const excludedNetworkRuleSamples = {};
  const supportedNetworkFilters = [];

  for (let index = 0; index < parsed.networkFilters.length; index += 1) {
    const filter = parsed.networkFilters[index];
    const debugFilter = debugParsed.networkFilters[index];
    const category = classifyNetworkFilter(filter);
    const debugCategory = classifyNetworkFilter(debugFilter);

    if (category !== debugCategory) {
      throw new Error("Debug and production rule classifications disagree.");
    }

    networkRuleCounts[category] = (networkRuleCounts[category] ?? 0) + 1;

    if (category === "supported-block" || category === "supported-exception") {
      supportedNetworkFilters.push(filter);
      continue;
    }

    const samples = (excludedNetworkRuleSamples[category] ??= []);

    if (samples.length < MAX_SAMPLES_PER_CATEGORY) {
      samples.push(debugFilter.rawLine ?? debugFilter.toString());
    }
  }

  const sourceLines = list.split("\n");
  const ignoredLineCounts = {
    empty: sourceLines.filter((line) => line.trim() === "").length,
    comment: sourceLines.filter(
      (line) => line.startsWith("!") && !line.startsWith("!#"),
    ).length,
    adguard: 0,
    unsupported: 0,
  };
  const unsupportedModifierCounts = {};
  const unsupportedSamples = [];

  for (const unsupported of parsed.notSupportedFilters) {
    if (unsupported.filterType === 100) {
      continue;
    }

    if (unsupported.filterType === 101) {
      continue;
    }

    if (unsupported.filterType === 102) {
      ignoredLineCounts.adguard += 1;
    } else {
      ignoredLineCounts.unsupported += 1;
    }

    const category = classifyUnsupportedSyntax(unsupported.filter);
    unsupportedModifierCounts[category] =
      (unsupportedModifierCounts[category] ?? 0) + 1;

    if (unsupportedSamples.length < MAX_SAMPLES_PER_CATEGORY) {
      unsupportedSamples.push({
        lineNumber: unsupported.lineNumber,
        category,
        filter: unsupported.filter,
      });
    }
  }

  return {
    supportedNetworkFilters,
    report: {
      schemaVersion: 1,
      sourceLines: countLines(list),
      totalNetworkRules: parsed.networkFilters.length,
      packagedNetworkRules: supportedNetworkFilters.length,
      excludedNetworkRules:
        parsed.networkFilters.length - supportedNetworkFilters.length,
      cosmeticRulesExcluded: parsed.cosmeticFilters.length,
      preprocessors: parsed.preprocessors.length,
      networkRuleCounts: sortRecord(networkRuleCounts),
      excludedNetworkRuleSamples: sortRecord(excludedNetworkRuleSamples),
      ignoredLineCounts,
      unsupportedModifierCounts: sortRecord(unsupportedModifierCounts),
      unsupportedSamples,
    },
  };
}

export function compileSupportedNetworkEngine(list) {
  const inventory = inventoryFilterList(list);

  if (inventory.report.preprocessors !== 0) {
    throw new Error("EasyPrivacy preprocessors are not supported.");
  }

  const engine = new FiltersEngine({
    networkFilters: inventory.supportedNetworkFilters,
    config: ENGINE_CONFIG,
  });

  return { engine, report: inventory.report };
}

export async function buildEasyPrivacyOutputs(
  source,
  sourceManifest,
  ghosteryPackageVersion,
) {
  ghosteryPackageVersion ??= await readGhosteryPackageVersion();
  const validated = validateSourceManifest(source, sourceManifest);
  const { engine, report } = compileSupportedNetworkEngine(validated.text);
  const artifact = Buffer.from(engine.serialize());
  const secondArtifact = Buffer.from(engine.serialize());

  if (!artifact.equals(secondArtifact)) {
    throw new Error("Serializing the same EasyPrivacy engine was not deterministic.");
  }

  const restoredArtifact = Buffer.from(
    FiltersEngine.deserialize(artifact).serialize(),
  );

  if (!artifact.equals(restoredArtifact)) {
    throw new Error("EasyPrivacy artifact changed after a round trip.");
  }

  const capabilitiesText = stableJson(report);
  const metadata = {
    schemaVersion: 1,
    sourceUrl: sourceManifest.sourceUrl,
    retrievedAt: sourceManifest.retrievedAt,
    upstreamVersion: sourceManifest.upstreamVersion,
    upstreamLastModified: sourceManifest.upstreamLastModified,
    upstreamCommit: sourceManifest.upstreamCommit,
    sourceSha256: sourceManifest.sourceSha256,
    sourceBytes: sourceManifest.sourceBytes,
    sourceLines: sourceManifest.sourceLines,
    generator: "scripts/easyprivacy/generate.mjs",
    generatorVersion: 1,
    ghosteryPackageVersion,
    enabledCapabilities: ["network-block", "network-exception"],
    engineConfiguration: ENGINE_CONFIG,
    artifactSha256: sha256(artifact),
    artifactBytes: artifact.byteLength,
    capabilityReportSha256: sha256(capabilitiesText),
    deterministicSerialization: true,
    deserializeSerializeRoundTrip: true,
    ruleCounts: {
      totalNetworkRules: report.totalNetworkRules,
      packagedNetworkRules: report.packagedNetworkRules,
      excludedNetworkRules: report.excludedNetworkRules,
      cosmeticRulesExcluded: report.cosmeticRulesExcluded,
      preprocessors: report.preprocessors,
      unsupported: report.ignoredLineCounts.unsupported,
    },
  };

  return {
    artifact,
    metadata,
    metadataText: stableJson(metadata),
    capabilities: report,
    capabilitiesText,
  };
}

export async function readCommittedInputs() {
  const [source, sourceManifestText] = await Promise.all([
    readFile(SOURCE_PATH),
    readFile(SOURCE_MANIFEST_PATH, "utf8"),
  ]);

  return {
    source,
    sourceManifest: JSON.parse(sourceManifestText),
  };
}

export async function readGeneratedOutputs() {
  const [artifact, metadataText, capabilitiesText] = await Promise.all([
    readFile(ARTIFACT_PATH),
    readFile(METADATA_PATH, "utf8"),
    readFile(CAPABILITIES_PATH, "utf8"),
  ]);

  return {
    artifact,
    metadata: JSON.parse(metadataText),
    metadataText,
    capabilities: JSON.parse(capabilitiesText),
    capabilitiesText,
  };
}

export async function publishFiles(files) {
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const temporaryFiles = [];

  try {
    for (const [targetPath, contents] of files) {
      await mkdir(dirname(targetPath), { recursive: true });
      const temporaryPath = `${targetPath}${suffix}`;
      await writeFile(temporaryPath, contents);
      temporaryFiles.push([temporaryPath, targetPath]);
    }

    for (const [temporaryPath, targetPath] of temporaryFiles) {
      await rename(temporaryPath, targetPath);
    }
  } finally {
    await Promise.all(
      temporaryFiles.map(([temporaryPath]) =>
        rm(temporaryPath, { force: true }).catch(() => undefined),
      ),
    );
  }
}

export async function readGhosteryPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(
      resolve(PROJECT_ROOT, "node_modules/@ghostery/adblocker/package.json"),
      "utf8",
    ),
  );

  if (typeof packageJson.version !== "string") {
    throw new Error("Installed Ghostery package has no version.");
  }

  return packageJson.version;
}

export function createRequest({
  requestId = "easyprivacy-request",
  tabId = 1,
  url,
  sourceUrl,
  type,
}) {
  return Request.fromRawDetails({
    requestId,
    tabId,
    url,
    sourceUrl,
    type,
  });
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createUpdateSummary(
  previousMetadata,
  previousCapabilities,
  nextMetadata,
  nextCapabilities,
) {
  const previousRules = previousMetadata?.ruleCounts ?? {};
  const nextRules = nextMetadata.ruleCounts;

  return {
    source: {
      previousVersion: previousMetadata?.upstreamVersion ?? null,
      nextVersion: nextMetadata.upstreamVersion,
      previousSha256: previousMetadata?.sourceSha256 ?? null,
      nextSha256: nextMetadata.sourceSha256,
      byteDelta: delta(previousMetadata?.sourceBytes, nextMetadata.sourceBytes),
    },
    artifact: {
      previousSha256: previousMetadata?.artifactSha256 ?? null,
      nextSha256: nextMetadata.artifactSha256,
      byteDelta: delta(
        previousMetadata?.artifactBytes,
        nextMetadata.artifactBytes,
      ),
    },
    rules: Object.fromEntries(
      Object.entries(nextRules).map(([key, value]) => [
        key,
        {
          previous: previousRules[key] ?? null,
          next: value,
          delta: delta(previousRules[key], value),
        },
      ]),
    ),
    supportedNetworkRuleCounts: compareRecords(
      previousCapabilities?.networkRuleCounts,
      nextCapabilities.networkRuleCounts,
      (key) => key.startsWith("supported-"),
    ),
    excludedNetworkRuleCounts: compareRecords(
      previousCapabilities?.networkRuleCounts,
      nextCapabilities.networkRuleCounts,
      (key) => !key.startsWith("supported-"),
    ),
    unsupportedModifierCounts: compareRecords(
      previousCapabilities?.unsupportedModifierCounts,
      nextCapabilities.unsupportedModifierCounts,
    ),
    unsupportedSamples: nextCapabilities.unsupportedSamples,
  };
}

function classifyUnsupportedSyntax(filter) {
  const modifierText = filter.includes("$")
    ? filter.slice(filter.lastIndexOf("$") + 1).toLowerCase()
    : "";
  const modifierNames = [
    ...new Set(
      modifierText
        .split(",")
        .map((modifier) => modifier.trim().replace(/^~/, "").split("=", 1)[0])
        .filter(Boolean),
    ),
  ].sort();

  if (modifierNames.length === 0) {
    return "unsupported-syntax";
  }

  if (
    modifierNames.some((name) =>
      ["removeparam", "urlskip", "urltransform", "uritransform"].includes(name),
    )
  ) {
    return "url-transformation";
  }

  if (
    modifierNames.some((name) =>
      ["redirect", "redirect-rule", "rewrite"].includes(name),
    )
  ) {
    return "redirect";
  }

  if (
    modifierNames.some((name) =>
      ["csp", "header", "permissions"].includes(name),
    )
  ) {
    return "response-or-header-modification";
  }

  if (modifierNames.some((name) => ["html", "replace"].includes(name))) {
    return "response-body-modification";
  }

  if (modifierNames.includes("method")) {
    return "request-method";
  }

  return `unsupported-modifier:${modifierNames.join("+")}`;
}

function readEasyPrivacyHeader(value) {
  const header = value.split("\n").slice(0, 40).join("\n");

  return {
    version: readHeaderValue(header, "Version"),
    title: readHeaderValue(header, "Title"),
    lastModified: readHeaderValue(header, "Last modified"),
    commit: readHeaderValue(header, "Commit"),
    licence: readHeaderValue(header, "Licence"),
  };
}

function readHeaderValue(header, name) {
  return header.match(new RegExp(`^! ${name}: (.+)$`, "m"))?.[1] ?? null;
}

function countLines(value) {
  return value.length === 0 ? 0 : value.split("\n").length;
}

function normalizeIsoDate(value) {
  if (typeof value !== "string") {
    throw new Error("EasyPrivacy retrieval time must be an ISO timestamp.");
  }

  const date = new Date(value);

  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error("EasyPrivacy retrieval time must be a canonical ISO timestamp.");
  }

  return value;
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function compareRecords(previous = {}, next = {}, include = () => true) {
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter(include)
    .sort();

  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        previous: previous[key] ?? 0,
        next: next[key] ?? 0,
        delta: (next[key] ?? 0) - (previous[key] ?? 0),
      },
    ]),
  );
}

function delta(previous, next) {
  return typeof previous === "number" ? next - previous : null;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
