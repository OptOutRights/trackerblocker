import catalogData from "../data/trackerCatalog.json";

export type CatalogCategory =
  | "advertising"
  | "analytics"
  | "session-replay"
  | "social"
  | "observability"
  | "payment"
  | "security"
  | "cdn";

export type CatalogDefaultAction = "block" | "allow" | "restrict";
export type CatalogMatchType = "domain" | "suffix";
export type CatalogRuleMatchType = "path-prefix" | "url-prefix";
export type CatalogConfidence = "high" | "medium" | "low";
export type CatalogBreakageRisk = "low" | "medium" | "high";

export interface TrackerCatalogRule {
  id: string;
  matchType: CatalogRuleMatchType;
  value: string;
  action: CatalogDefaultAction;
  explanation?: string;
}

export interface TrackerCatalogEntry {
  id: string;
  matchType: CatalogMatchType;
  domain: string;
  entity: string;
  category: CatalogCategory;
  defaultAction: CatalogDefaultAction;
  explanation: string;
  source?: string;
  confidence?: CatalogConfidence;
  breakageRisk?: CatalogBreakageRisk;
  notes?: string;
  rules?: TrackerCatalogRule[];
}

export interface TrackerCatalogMatch {
  entry: TrackerCatalogEntry;
  matchedDomain: string;
  action: CatalogDefaultAction;
  matchedRule: TrackerCatalogRule | null;
}

export const UNKNOWN_THIRD_PARTY_EXPLANATION =
  "This third party was seen loading resources, but it is not in the local tracker catalog yet.";

const CATEGORIES: ReadonlySet<string> = new Set([
  "advertising",
  "analytics",
  "session-replay",
  "social",
  "observability",
  "payment",
  "security",
  "cdn",
]);
const DEFAULT_ACTIONS: ReadonlySet<string> = new Set([
  "block",
  "allow",
  "restrict",
]);
const MATCH_TYPES: ReadonlySet<string> = new Set(["domain", "suffix"]);
const RULE_MATCH_TYPES: ReadonlySet<string> = new Set([
  "path-prefix",
  "url-prefix",
]);
const CONFIDENCE_VALUES: ReadonlySet<string> = new Set([
  "high",
  "medium",
  "low",
]);
const BREAKAGE_RISK_VALUES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
]);

export const TRACKER_CATALOG = loadTrackerCatalog(catalogData);

export function lookupTrackerCatalogEntry(
  domain: string | null | undefined,
  catalog: readonly TrackerCatalogEntry[] = TRACKER_CATALOG,
  requestUrl?: string | null,
): TrackerCatalogMatch | null {
  const normalizedDomain = normalizeCatalogDomain(domain);

  if (!normalizedDomain) {
    return null;
  }

  let bestMatch: TrackerCatalogEntry | null = null;

  for (const entry of catalog) {
    if (!catalogEntryMatchesDomain(entry, normalizedDomain)) {
      continue;
    }

    if (
      !bestMatch ||
      entry.domain.length > bestMatch.domain.length ||
      (entry.domain.length === bestMatch.domain.length &&
        entry.matchType === "domain" &&
        bestMatch.matchType === "suffix")
    ) {
      bestMatch = entry;
    }
  }

  const matchedRule = bestMatch
    ? findBestMatchingRule(bestMatch, requestUrl)
    : null;

  return bestMatch
    ? {
        entry: bestMatch,
        matchedDomain: normalizedDomain,
        action: matchedRule?.action ?? bestMatch.defaultAction,
        matchedRule,
      }
    : null;
}

export function loadTrackerCatalog(data: unknown): TrackerCatalogEntry[] {
  if (!Array.isArray(data)) {
    throw new Error("Tracker catalog must be an array.");
  }

  const entries = data.map(validateTrackerCatalogEntry);
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`Duplicate tracker catalog id: ${entry.id}`);
    }

    seenIds.add(entry.id);
  }

  return entries;
}

function validateTrackerCatalogEntry(
  value: unknown,
  index: number,
): TrackerCatalogEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Tracker catalog entry ${index} must be an object.`);
  }

  const entry = value as Record<string, unknown>;
  const id = readRequiredString(entry, "id", index);
  const domain = normalizeCatalogDomain(
    readRequiredString(entry, "domain", index),
  );
  const entity = readRequiredString(entry, "entity", index);
  const explanation = readRequiredString(entry, "explanation", index);
  const matchType = readEnum(
    entry,
    "matchType",
    MATCH_TYPES,
    index,
  ) as CatalogMatchType;
  const category = readEnum(
    entry,
    "category",
    CATEGORIES,
    index,
  ) as CatalogCategory;
  const defaultAction = readEnum(
    entry,
    "defaultAction",
    DEFAULT_ACTIONS,
    index,
  ) as CatalogDefaultAction;
  const source = readOptionalString(entry, "source", index);
  const confidence = readOptionalEnum(
    entry,
    "confidence",
    CONFIDENCE_VALUES,
    index,
  ) as CatalogConfidence | undefined;
  const breakageRisk = readOptionalEnum(
    entry,
    "breakageRisk",
    BREAKAGE_RISK_VALUES,
    index,
  ) as CatalogBreakageRisk | undefined;
  const notes = readOptionalString(entry, "notes", index);
  const rules = validateTrackerCatalogRules(entry.rules, index);

  if (!domain) {
    throw new Error(`Tracker catalog entry ${index} has an invalid domain.`);
  }

  if (
    (defaultAction === "block" || defaultAction === "restrict") &&
    !breakageRisk
  ) {
    throw new Error(
      `Tracker catalog entry ${index} needs breakageRisk for block or restrict defaults.`,
    );
  }

  if (Boolean(source) !== Boolean(confidence)) {
    throw new Error(
      `Tracker catalog entry ${index} needs both source and confidence when either is provided.`,
    );
  }

  if (explanation.split(/\s+/).filter(Boolean).length > 35) {
    throw new Error(
      `Tracker catalog entry ${index} explanation should be one concise sentence.`,
    );
  }

  return {
    id,
    matchType,
    domain,
    entity,
    category,
    defaultAction,
    explanation,
    source,
    confidence,
    breakageRisk,
    notes,
    rules,
  };
}

function validateTrackerCatalogRules(
  value: unknown,
  entryIndex: number,
): TrackerCatalogRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Tracker catalog entry ${entryIndex} rules must be an array.`);
  }

  return value.map((ruleValue, ruleIndex): TrackerCatalogRule => {
    if (typeof ruleValue !== "object" || ruleValue === null) {
      throw new Error(
        `Tracker catalog entry ${entryIndex} rule ${ruleIndex} must be an object.`,
      );
    }

    const rule = ruleValue as Record<string, unknown>;
    const id = readRequiredString(rule, "id", entryIndex);
    const matchType = readEnum(
      rule,
      "matchType",
      RULE_MATCH_TYPES,
      entryIndex,
    ) as CatalogRuleMatchType;
    const value = normalizeRuleValue(
      readRequiredString(rule, "value", entryIndex),
      matchType,
    );
    const action = readEnum(
      rule,
      "action",
      DEFAULT_ACTIONS,
      entryIndex,
    ) as CatalogDefaultAction;
    const explanation = readOptionalString(rule, "explanation", entryIndex);

    if (!value) {
      throw new Error(
        `Tracker catalog entry ${entryIndex} rule ${ruleIndex} has invalid value.`,
      );
    }

    return {
      id,
      matchType,
      value,
      action,
      explanation,
    };
  });
}

function catalogEntryMatchesDomain(
  entry: TrackerCatalogEntry,
  normalizedDomain: string,
): boolean {
  if (entry.matchType === "domain") {
    return normalizedDomain === entry.domain;
  }

  return (
    normalizedDomain === entry.domain ||
    normalizedDomain.endsWith(`.${entry.domain}`)
  );
}

function findBestMatchingRule(
  entry: TrackerCatalogEntry,
  requestUrl?: string | null,
): TrackerCatalogRule | null {
  if (!requestUrl || !entry.rules?.length) {
    return null;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return null;
  }

  const normalizedPath = parsedUrl.pathname;
  const normalizedUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;
  let bestRule: TrackerCatalogRule | null = null;

  for (const rule of entry.rules) {
    const candidate =
      rule.matchType === "path-prefix" ? normalizedPath : normalizedUrl;

    if (!candidate.startsWith(rule.value)) {
      continue;
    }

    if (!bestRule || rule.value.length > bestRule.value.length) {
      bestRule = rule;
    }
  }

  return bestRule;
}

function normalizeCatalogDomain(domain: string | null | undefined): string {
  return domain?.trim().toLowerCase().replace(/\.+$/, "") ?? "";
}

function normalizeRuleValue(
  value: string,
  matchType: CatalogRuleMatchType,
): string {
  const normalized = value.trim();

  if (matchType === "path-prefix") {
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  try {
    const url = new URL(normalized);

    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

function readRequiredString(
  entry: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = entry[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Tracker catalog entry ${index} needs ${field}.`);
  }

  return value.trim();
}

function readOptionalString(
  entry: Record<string, unknown>,
  field: string,
  index: number,
): string | undefined {
  const value = entry[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Tracker catalog entry ${index} has invalid ${field}.`);
  }

  return value.trim();
}

function readEnum(
  entry: Record<string, unknown>,
  field: string,
  allowedValues: ReadonlySet<string>,
  index: number,
): string {
  const value = readRequiredString(entry, field, index);

  if (!allowedValues.has(value)) {
    throw new Error(`Tracker catalog entry ${index} has invalid ${field}.`);
  }

  return value;
}

function readOptionalEnum(
  entry: Record<string, unknown>,
  field: string,
  allowedValues: ReadonlySet<string>,
  index: number,
): string | undefined {
  const value = entry[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !allowedValues.has(value)) {
    throw new Error(`Tracker catalog entry ${index} has invalid ${field}.`);
  }

  return value;
}
