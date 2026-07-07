import {
  classifyRequestSiteRelationship,
  formatUrlHost,
} from "./domains";
import {
  lookupTrackerCatalogEntry,
  UNKNOWN_THIRD_PARTY_EXPLANATION,
  type CatalogCategory,
  type CatalogDefaultAction,
} from "./trackerCatalog";
import {
  decideRule,
  type DomainOverrideAction,
  type RuleDecisionSource,
  type RuleDecisionStatus,
} from "./ruleDecisions";

export type RequestTypeCategory =
  | "script"
  | "image"
  | "iframe"
  | "xhr"
  | "beacon"
  | "stylesheet"
  | "other";

export type RequestRelationship = "third-party" | "unknown" | "first-party";

export interface RequestEvidence {
  tabId: number;
  frameId: number;
  pageUrl?: string | null;
  requestUrl?: string | null;
  requestType?: string | null;
  timestamp: number;
  sitePaused?: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
}

export interface ObservedRequestRow {
  id: string;
  displayName: string;
  relationship: RequestRelationship;
  category: CatalogCategory | "unknown";
  entity: string | null;
  explanation: string;
  catalogDefaultAction: CatalogDefaultAction | null;
  status: RuleDecisionStatus;
  ruleSource: RuleDecisionSource;
  requestCount: number;
  requestTypes: RequestTypeCategory[];
  lastSeen: number;
}

export interface TabRequestSummary {
  tabId: number;
  siteUrl: string | null;
  siteHost: string | null;
  totalRequests: number;
  thirdPartyCount: number;
  unknownCount: number;
  firstPartyCount: number;
  blockedCount: number;
  allowedCount: number;
  rows: ObservedRequestRow[];
}

export interface TabObservationState {
  tabId: number;
  pageUrl: string | null;
  rows: Map<string, ObservedRequestRow>;
}

export interface SummaryDecisionOptions {
  sitePaused?: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
}

const FIRST_PARTY_EXPLANATION =
  "This request appears to belong to the current site.";
const UNKNOWN_REQUEST_EXPLANATION =
  "This request was observed, but TrackerBlocker could not classify its site relationship.";
const RELATIONSHIP_ORDER: Record<RequestRelationship, number> = {
  "third-party": 0,
  unknown: 1,
  "first-party": 2,
};
const EMPTY_WEB_AUTHORITY_PATTERN = /^(?:https?|wss?):\/\/[/?#]/i;

export function createTabObservationState(
  tabId: number,
  pageUrl?: string | null,
): TabObservationState {
  return {
    tabId,
    pageUrl: pageUrl ?? null,
    rows: new Map(),
  };
}

export function resetTabObservationState(
  state: TabObservationState,
  pageUrl?: string | null,
): void {
  state.pageUrl = pageUrl ?? null;
  state.rows.clear();
}

export function mapRequestType(
  requestType?: string | null,
): RequestTypeCategory {
  switch (requestType) {
    case "script":
      return "script";
    case "image":
      return "image";
    case "sub_frame":
      return "iframe";
    case "xmlhttprequest":
      return "xhr";
    case "beacon":
    case "ping":
      return "beacon";
    case "stylesheet":
      return "stylesheet";
    default:
      return "other";
  }
}

export function recordObservedRequest(
  state: TabObservationState,
  evidence: RequestEvidence,
): ObservedRequestRow {
  const pageUrl = state.pageUrl ?? evidence.pageUrl;
  const classification = classifyRequestSiteRelationship({
    pageUrl,
    requestUrl: evidence.requestUrl,
  });

  const requestType = mapRequestType(evidence.requestType);
  const rowSeed: {
    relationship: RequestRelationship;
    key: string;
    displayName: string;
  } =
    classification.status === "third-party" ||
    classification.status === "same-site"
      ? {
          relationship:
            classification.status === "third-party"
              ? "third-party"
              : "first-party",
          key: classification.requestSite,
          displayName: classification.requestSite,
        }
      : {
          relationship: "unknown",
          key: getUnknownRequestKey(evidence.requestUrl),
          displayName: getUnknownRequestDisplayName(evidence.requestUrl),
        };

  const id = `${rowSeed.relationship}:${rowSeed.key}`;
  const existing = state.rows.get(id);
  const catalogFields = getCatalogFields(rowSeed);
  const decision = decideRule({
    relationship: rowSeed.relationship,
    catalogDefaultAction: catalogFields.catalogDefaultAction,
    domainOverride: evidence.domainOverrides?.[rowSeed.key] ?? null,
    sitePaused: evidence.sitePaused,
  });

  if (!existing) {
    const row: ObservedRequestRow = {
      id,
      displayName: rowSeed.displayName,
      relationship: rowSeed.relationship,
      ...catalogFields,
      status: decision.status,
      ruleSource: decision.source,
      requestCount: 1,
      requestTypes: [requestType],
      lastSeen: evidence.timestamp,
    };

    state.rows.set(id, row);
    return row;
  }

  existing.requestCount += 1;
  existing.lastSeen = Math.max(existing.lastSeen, evidence.timestamp);
  existing.status = decision.status;
  existing.ruleSource = decision.source;

  if (!existing.requestTypes.includes(requestType)) {
    existing.requestTypes = [...existing.requestTypes, requestType].sort();
  }

  return existing;
}

export function summarizeTabObservation(
  state: TabObservationState,
  decisionOptions: SummaryDecisionOptions = {},
): TabRequestSummary {
  const rows = [...state.rows.values()]
    .map((row) => applyRowDecision(row, decisionOptions))
    .sort(compareObservedRows);

  return {
    tabId: state.tabId,
    siteUrl: state.pageUrl,
    siteHost: formatUrlHost(state.pageUrl),
    totalRequests: rows.reduce((sum, row) => sum + row.requestCount, 0),
    thirdPartyCount: rows.filter((row) => row.relationship === "third-party")
      .length,
    unknownCount: rows.filter((row) => row.status === "unknown").length,
    firstPartyCount: rows.filter((row) => row.relationship === "first-party")
      .length,
    blockedCount: rows.filter((row) => row.status === "blocked").length,
    allowedCount: rows.filter(
      (row) => row.status === "allowed" || row.status === "allowed-paused",
    ).length,
    rows,
  };
}

function applyRowDecision(
  row: ObservedRequestRow,
  decisionOptions: SummaryDecisionOptions,
): ObservedRequestRow {
  const decision = decideRule({
    relationship: row.relationship,
    catalogDefaultAction: row.catalogDefaultAction,
    domainOverride: decisionOptions.domainOverrides?.[row.displayName] ?? null,
    sitePaused: decisionOptions.sitePaused,
  });

  return {
    ...row,
    status: decision.status,
    ruleSource: decision.source,
  };
}

function getCatalogFields(rowSeed: {
  relationship: RequestRelationship;
  displayName: string;
}): Pick<
  ObservedRequestRow,
  "category" | "entity" | "explanation" | "catalogDefaultAction"
> {
  if (rowSeed.relationship === "first-party") {
    return {
      category: "unknown",
      entity: null,
      explanation: FIRST_PARTY_EXPLANATION,
      catalogDefaultAction: null,
    };
  }

  if (rowSeed.relationship === "unknown") {
    return {
      category: "unknown",
      entity: null,
      explanation: UNKNOWN_REQUEST_EXPLANATION,
      catalogDefaultAction: null,
    };
  }

  const catalogMatch = lookupTrackerCatalogEntry(rowSeed.displayName);

  return {
    category: catalogMatch?.entry.category ?? "unknown",
    entity: catalogMatch?.entry.entity ?? null,
    explanation:
      catalogMatch?.entry.explanation ?? UNKNOWN_THIRD_PARTY_EXPLANATION,
    catalogDefaultAction: catalogMatch?.entry.defaultAction ?? null,
  };
}

function compareObservedRows(
  left: ObservedRequestRow,
  right: ObservedRequestRow,
): number {
  const relationshipDelta =
    RELATIONSHIP_ORDER[left.relationship] -
    RELATIONSHIP_ORDER[right.relationship];

  if (relationshipDelta !== 0) {
    return relationshipDelta;
  }

  if (left.requestCount !== right.requestCount) {
    return right.requestCount - left.requestCount;
  }

  return left.displayName.localeCompare(right.displayName);
}

function getUnknownRequestKey(requestUrl?: string | null): string {
  return getUnknownRequestDisplayName(requestUrl).toLowerCase();
}

function getUnknownRequestDisplayName(requestUrl?: string | null): string {
  if (!requestUrl) {
    return "Missing request URL";
  }

  if (EMPTY_WEB_AUTHORITY_PATTERN.test(requestUrl)) {
    return "Unclassifiable request";
  }

  const webHost = formatUrlHost(requestUrl);

  if (webHost) {
    return webHost;
  }

  try {
    const url = new URL(requestUrl);
    const scheme = url.protocol.replace(/:$/, "");

    if (url.hostname) {
      return `${scheme}:${url.hostname}`;
    }

    if (scheme === "about" && url.pathname) {
      return `${scheme}:${url.pathname}`;
    }

    return `${scheme}:`;
  } catch {
    return "Unclassifiable request";
  }
}
