import {
  FiltersEngine as GhosteryFiltersEngine,
  Request as GhosteryRequest,
  type NetworkFilter as GhosteryNetworkFilter,
  type RequestType as GhosteryRequestType,
} from "@ghostery/adblocker";

export type FilterEngineHealth = "loading" | "ready" | "degraded";
export type FilterEngineDegradedReason =
  | "artifact-load-failed"
  | "artifact-invalid"
  | "engine-invalid";

export interface FilterRequestContext {
  requestId: string;
  tabId: number;
  url: string;
  sourceUrl?: string | null;
  type?: string | null;
}

export interface FilterRuleEvidence {
  key: string;
  engineId: string;
  normalizedSummary: string;
  requestTypes: string[];
  partyScope: "first-party" | "third-party" | "any";
  sourceConstraint: "none" | "compacted";
}

export interface FilterEngineProvenance {
  upstreamVersion: string;
  upstreamLastModified: string;
  upstreamCommit: string;
  sourceSha256: string;
  artifactSha256: string;
  ghosteryPackageVersion: string;
  packagedNetworkRules: number;
}

export interface FilterEngineArtifact {
  artifact: Uint8Array;
  metadata: unknown;
}

export type FilterEngineArtifactLoader = () => Promise<FilterEngineArtifact>;

export type FilterMatchResult =
  | {
      outcome: "unavailable";
      health: "loading" | "degraded";
      matchedFilter: null;
      matchedException: null;
    }
  | {
      outcome: "no-match";
      health: "ready";
      matchedFilter: null;
      matchedException: null;
    }
  | {
      outcome: "block";
      health: "ready";
      matchedFilter: FilterRuleEvidence;
      matchedException: null;
    }
  | {
      outcome: "exception";
      health: "ready";
      matchedFilter: FilterRuleEvidence | null;
      matchedException: FilterRuleEvidence;
    };

interface EasyPrivacyArtifactMetadata {
  schemaVersion: 1;
  artifactBytes: number;
  artifactSha256: string;
  enabledCapabilities: ["network-block", "network-exception"];
  upstreamVersion: string;
  upstreamLastModified: string;
  upstreamCommit: string;
  sourceSha256: string;
  ghosteryPackageVersion: string;
  engineConfiguration: {
    debug: false;
  };
  ruleCounts: {
    packagedNetworkRules: number;
  };
}

const SUPPORTED_REQUEST_TYPES = new Set<string>([
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "object_subrequest",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "other",
  "xslt",
  "beacon",
  "xml_dtd",
  "imageset",
  "web_manifest",
  "speculative",
  "json",
]);

export class FilterEngine {
  #engine: GhosteryFiltersEngine | null = null;
  #health: FilterEngineHealth = "loading";
  #degradedReason: FilterEngineDegradedReason | null = null;
  #initialization: Promise<void> | null = null;
  #provenance: FilterEngineProvenance | null = null;
  #ruleEvidence = new WeakMap<GhosteryNetworkFilter, FilterRuleEvidence>();

  get health(): FilterEngineHealth {
    return this.#health;
  }

  get degradedReason(): FilterEngineDegradedReason | null {
    return this.#degradedReason;
  }

  get provenance(): FilterEngineProvenance | null {
    return this.#provenance;
  }

  initialize(loadArtifact: FilterEngineArtifactLoader): Promise<void> {
    if (this.#initialization) {
      return this.#initialization;
    }

    this.#health = "loading";
    this.#degradedReason = null;
    this.#initialization = this.#load(loadArtifact);
    return this.#initialization;
  }

  match(context: FilterRequestContext): FilterMatchResult {
    if (!this.#engine || this.#health !== "ready") {
      return unavailableResult(this.#health);
    }

    try {
      const request = GhosteryRequest.fromRawDetails({
        requestId: context.requestId,
        tabId: context.tabId,
        url: context.url,
        sourceUrl: context.sourceUrl ?? "",
        type: normalizeRequestType(context.type),
      });

      if (!request.isSupported) {
        return noMatchResult();
      }

      const result = this.#engine.match(request);

      if (result.redirect !== undefined || result.rewrite !== undefined) {
        return this.#degrade("engine-invalid");
      }

      if (result.exception) {
        return {
          outcome: "exception",
          health: "ready",
          matchedFilter: result.filter
            ? this.#createRuleEvidence(result.filter)
            : null,
          matchedException: this.#createRuleEvidence(result.exception),
        };
      }

      if (result.match && result.filter) {
        return {
          outcome: "block",
          health: "ready",
          matchedFilter: this.#createRuleEvidence(result.filter),
          matchedException: null,
        };
      }

      if (!result.match && !result.filter) {
        return noMatchResult();
      }

      return this.#degrade("engine-invalid");
    } catch {
      return this.#degrade("engine-invalid");
    }
  }

  async #load(loadArtifact: FilterEngineArtifactLoader): Promise<void> {
    let loaded: FilterEngineArtifact;

    try {
      loaded = await loadArtifact();
    } catch {
      this.#degrade("artifact-load-failed");
      return;
    }

    try {
      const metadata = validateMetadata(loaded.metadata);
      await validateArtifact(loaded.artifact, metadata);
      this.#engine = GhosteryFiltersEngine.deserialize(loaded.artifact);
      this.#provenance = createProvenance(metadata);
      this.#health = "ready";
      this.#degradedReason = null;
    } catch {
      this.#degrade("artifact-invalid");
    }
  }

  #degrade(reason: FilterEngineDegradedReason): Extract<
    FilterMatchResult,
    { outcome: "unavailable" }
  > {
    this.#engine = null;
    this.#provenance = null;
    this.#health = "degraded";
    this.#degradedReason = reason;
    return unavailableResult("degraded");
  }

  #createRuleEvidence(filter: GhosteryNetworkFilter): FilterRuleEvidence {
    const cached = this.#ruleEvidence.get(filter);

    if (cached) {
      return cached;
    }

    const engineId = (filter.getId() >>> 0).toString(16).padStart(8, "0");
    const normalizedSummary = filter
      .toString((modifier) =>
        modifier === "domain=<hashed>" ? "domain=<compacted>" : modifier,
      )
      .slice(0, 160);
    const artifactScope = this.#provenance?.artifactSha256.slice(0, 12) ??
      "unscoped";
    const evidence: FilterRuleEvidence = {
      key: `easyprivacy:${artifactScope}:${engineId}:${stableHash(normalizedSummary)}`,
      engineId: `easyprivacy:${engineId}`,
      normalizedSummary,
      requestTypes: getRuleRequestTypes(filter),
      partyScope: filter.firstParty() !== filter.thirdParty()
        ? filter.firstParty()
          ? "first-party"
          : "third-party"
        : "any",
      sourceConstraint: filter.hasDomains() ? "compacted" : "none",
    };
    this.#ruleEvidence.set(filter, evidence);
    return evidence;
  }
}

function validateMetadata(value: unknown): EasyPrivacyArtifactMetadata {
  if (!isPlainObject(value) || value.schemaVersion !== 1) {
    throw new Error("Unsupported EasyPrivacy metadata schema.");
  }

  if (
    !Number.isSafeInteger(value.artifactBytes) ||
    (value.artifactBytes as number) <= 0
  ) {
    throw new Error("Invalid EasyPrivacy artifact size.");
  }

  if (
    typeof value.artifactSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.artifactSha256)
  ) {
    throw new Error("Invalid EasyPrivacy artifact checksum.");
  }

  if (
    !Array.isArray(value.enabledCapabilities) ||
    value.enabledCapabilities.length !== 2 ||
    value.enabledCapabilities[0] !== "network-block" ||
    value.enabledCapabilities[1] !== "network-exception"
  ) {
    throw new Error("Unexpected EasyPrivacy runtime capabilities.");
  }

  for (const key of [
    "upstreamVersion",
    "upstreamLastModified",
    "upstreamCommit",
    "sourceSha256",
    "ghosteryPackageVersion",
  ] as const) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`Invalid EasyPrivacy metadata field ${key}.`);
    }
  }

  if (
    !isPlainObject(value.engineConfiguration) ||
    value.engineConfiguration.debug !== false ||
    !isPlainObject(value.ruleCounts) ||
    !Number.isSafeInteger(value.ruleCounts.packagedNetworkRules) ||
    (value.ruleCounts.packagedNetworkRules as number) <= 0
  ) {
    throw new Error("Invalid EasyPrivacy explanation metadata.");
  }

  return value as unknown as EasyPrivacyArtifactMetadata;
}

async function validateArtifact(
  artifact: Uint8Array,
  metadata: EasyPrivacyArtifactMetadata,
): Promise<void> {
  if (!(artifact instanceof Uint8Array)) {
    throw new Error("EasyPrivacy artifact is not binary data.");
  }

  if (artifact.byteLength !== metadata.artifactBytes) {
    throw new Error("EasyPrivacy artifact size does not match metadata.");
  }

  const digestInput = new Uint8Array(artifact.byteLength);
  digestInput.set(artifact);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  const checksum = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (checksum !== metadata.artifactSha256) {
    throw new Error("EasyPrivacy artifact checksum does not match metadata.");
  }
}

function normalizeRequestType(
  value: string | null | undefined,
): GhosteryRequestType {
  return (value && SUPPORTED_REQUEST_TYPES.has(value) ? value : "other") as
    GhosteryRequestType;
}

function createProvenance(
  metadata: EasyPrivacyArtifactMetadata,
): FilterEngineProvenance {
  return {
    upstreamVersion: metadata.upstreamVersion,
    upstreamLastModified: metadata.upstreamLastModified,
    upstreamCommit: metadata.upstreamCommit,
    sourceSha256: metadata.sourceSha256,
    artifactSha256: metadata.artifactSha256,
    ghosteryPackageVersion: metadata.ghosteryPackageVersion,
    packagedNetworkRules: metadata.ruleCounts.packagedNetworkRules,
  };
}

function getRuleRequestTypes(filter: GhosteryNetworkFilter): string[] {
  if (filter.fromAny()) {
    return [];
  }

  const types: Array<[string, () => boolean]> = [
    ["script", () => filter.fromScript()],
    ["image", () => filter.fromImage()],
    ["stylesheet", () => filter.fromStylesheet()],
    ["font", () => filter.fromFont()],
    ["media", () => filter.fromMedia()],
    ["object", () => filter.fromObject()],
    ["sub_frame", () => filter.fromSubdocument()],
    ["xmlhttprequest", () => filter.fromXmlHttpRequest()],
    ["ping", () => filter.fromPing()],
    ["websocket", () => filter.fromWebsocket()],
    ["other", () => filter.fromOther()],
  ];

  return types.filter(([, matches]) => matches()).map(([type]) => type);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function unavailableResult(
  health: FilterEngineHealth,
): Extract<FilterMatchResult, { outcome: "unavailable" }> {
  return {
    outcome: "unavailable",
    health: health === "loading" ? "loading" : "degraded",
    matchedFilter: null,
    matchedException: null,
  };
}

function noMatchResult(): Extract<
  FilterMatchResult,
  { outcome: "no-match" }
> {
  return {
    outcome: "no-match",
    health: "ready",
    matchedFilter: null,
    matchedException: null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
