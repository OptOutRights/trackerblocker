import catalogData from "../data/trackerCatalog.json";

export type CatalogCategory =
  | "advertising"
  | "analytics"
  | "session-replay"
  | "social"
  | "payment"
  | "security"
  | "cdn";

export type CatalogDefaultAction = "block" | "allow";
export type CatalogMatchType = "domain" | "suffix";

export interface TrackerCatalogEntry {
  id: string;
  matchType: CatalogMatchType;
  domain: string;
  entity: string;
  category: CatalogCategory;
  defaultAction: CatalogDefaultAction;
  explanation: string;
}

export interface TrackerCatalogMatch {
  entry: TrackerCatalogEntry;
  matchedDomain: string;
}

export const UNKNOWN_THIRD_PARTY_EXPLANATION =
  "This third party was seen loading resources, but it is not in the local tracker catalog yet.";

const CATEGORIES: ReadonlySet<string> = new Set([
  "advertising",
  "analytics",
  "session-replay",
  "social",
  "payment",
  "security",
  "cdn",
]);
const DEFAULT_ACTIONS: ReadonlySet<string> = new Set(["block", "allow"]);
const MATCH_TYPES: ReadonlySet<string> = new Set(["domain", "suffix"]);

export const TRACKER_CATALOG = loadTrackerCatalog(catalogData);

export function lookupTrackerCatalogEntry(
  domain: string | null | undefined,
  catalog: readonly TrackerCatalogEntry[] = TRACKER_CATALOG,
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

  return bestMatch
    ? {
        entry: bestMatch,
        matchedDomain: normalizedDomain,
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

  if (!domain) {
    throw new Error(`Tracker catalog entry ${index} has an invalid domain.`);
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
  };
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

function normalizeCatalogDomain(domain: string | null | undefined): string {
  return domain?.trim().toLowerCase().replace(/\.+$/, "") ?? "";
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
