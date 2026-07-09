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
  | "font"
  | "media"
  | "websocket"
  | "object"
  | "manifest"
  | "prefetch"
  | "other";

export type RequestRelationship = "third-party" | "unknown" | "first-party";
export type RequestLifecycleStatus =
  | "started"
  | "completed"
  | "blocked"
  | "failed"
  | "redirected";
export type VisibilityNote =
  | "visible-request"
  | "exit-beacon-may-be-missed"
  | "websocket-frames-not-classified"
  | "frame-ancestry-limited"
  | "browser-cache-may-hide-requests"
  | "dns-or-preconnect-not-visible"
  | "headers-not-inspected"
  | "non-web-or-unclassifiable";

export interface RequestLifecycleCounts {
  started: number;
  completed: number;
  blocked: number;
  failed: number;
  redirected: number;
}

export interface RequestContextEvidence {
  frameIds: number[];
  frameContexts: RequestFrameContext[];
  documentHosts: string[];
  initiatorHosts: string[];
  pathHints: string[];
  visibilityNotes: VisibilityNote[];
}

export interface RequestFrameContext {
  frameId: number;
  parentFrameId: number | null;
  frameHost: string | null;
  documentHost: string | null;
  relationship: RequestRelationship;
}

export interface RequestRedirectHop {
  fromHost: string | null;
  toHost: string | null;
  statusCode: number | null;
  timestamp: number;
}

export interface RequestEvidence {
  requestId?: string | null;
  tabId: number;
  frameId: number;
  parentFrameId?: number;
  pageUrl?: string | null;
  documentUrl?: string | null;
  originUrl?: string | null;
  initiator?: string | null;
  requestUrl?: string | null;
  requestType?: string | null;
  timestamp: number;
  sitePaused?: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
}

export interface ObservedRequestRow {
  id: string;
  host: string | null;
  siteDomain: string | null;
  displayName: string;
  relationship: RequestRelationship;
  category: CatalogCategory | "unknown";
  entity: string | null;
  explanation: string;
  catalogDefaultAction: CatalogDefaultAction | null;
  catalogSource: string | null;
  catalogConfidence: string | null;
  catalogBreakageRisk: string | null;
  catalogRuleId: string | null;
  catalogNotes: string | null;
  status: RuleDecisionStatus;
  ruleSource: RuleDecisionSource;
  requestCount: number;
  requestTypes: RequestTypeCategory[];
  firstSeen: number;
  lastSeen: number;
  lifecycle: RequestLifecycleCounts;
  context: RequestContextEvidence;
  redirectHops: RequestRedirectHop[];
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
  restrictedCount: number;
  allowedCount: number;
  rows: ObservedRequestRow[];
}

export interface TabObservationState {
  tabId: number;
  pageUrl: string | null;
  rows: Map<string, ObservedRequestRow>;
  requestRows: Map<string, string>;
}

export interface SummaryDecisionOptions {
  sitePaused?: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
}

const FIRST_PARTY_EXPLANATION =
  "This request appears to belong to the current site.";
const UNKNOWN_REQUEST_EXPLANATION =
  "This request was observed, but TrackerBlocker could not classify its site relationship.";
const EMPTY_LIFECYCLE_COUNTS: RequestLifecycleCounts = {
  started: 0,
  completed: 0,
  blocked: 0,
  failed: 0,
  redirected: 0,
};
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
    requestRows: new Map(),
  };
}

export function resetTabObservationState(
  state: TabObservationState,
  pageUrl?: string | null,
): void {
  state.pageUrl = pageUrl ?? null;
  state.rows.clear();
  state.requestRows.clear();
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
    case "font":
      return "font";
    case "media":
      return "media";
    case "websocket":
      return "websocket";
    case "object":
    case "object_subrequest":
      return "object";
    case "manifest":
      return "manifest";
    case "speculative":
    case "preload":
    case "prefetch":
      return "prefetch";
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
    host: string | null;
    siteDomain: string | null;
    displayName: string;
  } =
    classification.status === "third-party" ||
    classification.status === "same-site"
      ? {
          relationship:
            classification.status === "third-party"
              ? "third-party"
              : "first-party",
          key: classification.requestHost,
          host: classification.requestHost,
          siteDomain: classification.requestSite,
          displayName: classification.requestHost,
        }
      : {
          relationship: "unknown",
          key: getUnknownRequestKey(evidence.requestUrl),
          host: null,
          siteDomain: null,
          displayName: getUnknownRequestDisplayName(evidence.requestUrl),
        };

  const id = `${rowSeed.relationship}:${rowSeed.key}`;
  const existing = state.rows.get(id);
  const catalogFields = getCatalogFields(rowSeed, evidence.requestUrl);
  const decision = decideRule({
    relationship: rowSeed.relationship,
    catalogDefaultAction: catalogFields.catalogDefaultAction,
    domainOverride: evidence.domainOverrides?.[rowSeed.key] ?? null,
    sitePaused: evidence.sitePaused,
  });
  const contextUpdate = buildRequestContextEvidence(
    evidence,
    rowSeed.relationship,
    requestType,
  );
  const lifecycleUpdate = createStartedLifecycle(decision.shouldBlock);

  if (!existing) {
    const row: ObservedRequestRow = {
      id,
      host: rowSeed.host,
      siteDomain: rowSeed.siteDomain,
      displayName: rowSeed.displayName,
      relationship: rowSeed.relationship,
      ...catalogFields,
      status: decision.status,
      ruleSource: decision.source,
      requestCount: 1,
      requestTypes: [requestType],
      firstSeen: evidence.timestamp,
      lastSeen: evidence.timestamp,
      lifecycle: lifecycleUpdate,
      context: contextUpdate,
      redirectHops: [],
    };

    state.rows.set(id, row);
    rememberRequestRow(state, evidence.requestId, id);
    return row;
  }

  existing.requestCount += 1;
  existing.lastSeen = Math.max(existing.lastSeen, evidence.timestamp);
  existing.status = decision.status;
  existing.ruleSource = decision.source;
  existing.lifecycle = mergeLifecycleCounts(
    existing.lifecycle,
    lifecycleUpdate,
  );
  existing.context = mergeRequestContextEvidence(
    existing.context,
    contextUpdate,
  );

  if (!existing.requestTypes.includes(requestType)) {
    existing.requestTypes = [...existing.requestTypes, requestType].sort();
  }

  rememberRequestRow(state, evidence.requestId, id);
  return existing;
}

export interface RequestRedirectEvidence {
  requestId?: string | null;
  fromUrl?: string | null;
  redirectUrl?: string | null;
  statusCode?: number | null;
  timestamp: number;
}

export interface RequestCompletionEvidence {
  requestId?: string | null;
  timestamp: number;
}

export function recordRequestRedirect(
  state: TabObservationState,
  evidence: RequestRedirectEvidence,
): ObservedRequestRow | null {
  const row = getRowForRequestId(state, evidence.requestId);

  if (!row) {
    return null;
  }

  row.lastSeen = Math.max(row.lastSeen, evidence.timestamp);
  row.lifecycle = mergeLifecycleCounts(row.lifecycle, {
    redirected: 1,
  });
  row.redirectHops = appendRedirectHop(row.redirectHops, {
    fromHost: formatUrlHost(evidence.fromUrl),
    toHost: formatUrlHost(evidence.redirectUrl),
    statusCode:
      typeof evidence.statusCode === "number" ? evidence.statusCode : null,
    timestamp: evidence.timestamp,
  });

  return row;
}

export function recordRequestCompleted(
  state: TabObservationState,
  evidence: RequestCompletionEvidence,
): ObservedRequestRow | null {
  return recordLifecycleTerminalState(state, evidence, "completed");
}

export function recordRequestFailed(
  state: TabObservationState,
  evidence: RequestCompletionEvidence,
): ObservedRequestRow | null {
  return recordLifecycleTerminalState(state, evidence, "failed");
}

function recordLifecycleTerminalState(
  state: TabObservationState,
  evidence: RequestCompletionEvidence,
  lifecycleStatus: Extract<RequestLifecycleStatus, "completed" | "failed">,
): ObservedRequestRow | null {
  const row = getRowForRequestId(state, evidence.requestId);

  if (!row) {
    return null;
  }

  row.lastSeen = Math.max(row.lastSeen, evidence.timestamp);
  if (!(lifecycleStatus === "failed" && row.lifecycle.blocked > 0)) {
    row.lifecycle = mergeLifecycleCounts(row.lifecycle, {
      [lifecycleStatus]: 1,
    });
  }

  if (evidence.requestId) {
    state.requestRows.delete(evidence.requestId);
  }

  return row;
}

export function mergeLifecycleCounts(
  current: RequestLifecycleCounts,
  update: Partial<RequestLifecycleCounts>,
): RequestLifecycleCounts {
  return {
    started: current.started + (update.started ?? 0),
    completed: current.completed + (update.completed ?? 0),
    blocked: current.blocked + (update.blocked ?? 0),
    failed: current.failed + (update.failed ?? 0),
    redirected: current.redirected + (update.redirected ?? 0),
  };
}

function rememberRequestRow(
  state: TabObservationState,
  requestId: string | null | undefined,
  rowId: string,
): void {
  if (requestId) {
    state.requestRows.set(requestId, rowId);
  }
}

function getRowForRequestId(
  state: TabObservationState,
  requestId: string | null | undefined,
): ObservedRequestRow | null {
  if (!requestId) {
    return null;
  }

  const rowId = state.requestRows.get(requestId);

  return rowId ? state.rows.get(rowId) ?? null : null;
}

function appendRedirectHop(
  current: readonly RequestRedirectHop[],
  hop: RequestRedirectHop,
): RequestRedirectHop[] {
  const next = [...current, hop];

  return next.slice(-8);
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
    unknownCount: rows.filter(isUnknownRow).length,
    firstPartyCount: rows.filter((row) => row.relationship === "first-party")
      .length,
    blockedCount: rows.filter((row) => row.status === "blocked").length,
    restrictedCount: rows.filter((row) => row.status === "restricted").length,
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
    domainOverride: getDomainOverride(row, decisionOptions.domainOverrides),
    sitePaused: decisionOptions.sitePaused,
  });

  return {
    ...row,
    status: decision.status,
    ruleSource: decision.source,
  };
}

export function isUnknownRow(row: ObservedRequestRow): boolean {
  return (
    row.relationship === "unknown" ||
    (row.relationship === "third-party" && row.category === "unknown")
  );
}

function getCatalogFields(rowSeed: {
  relationship: RequestRelationship;
  displayName: string;
}, requestUrl?: string | null): Pick<
  ObservedRequestRow,
  | "category"
  | "entity"
  | "explanation"
  | "catalogDefaultAction"
  | "catalogSource"
  | "catalogConfidence"
  | "catalogBreakageRisk"
  | "catalogRuleId"
  | "catalogNotes"
> {
  if (rowSeed.relationship === "first-party") {
    return {
      category: "unknown",
      entity: null,
      explanation: FIRST_PARTY_EXPLANATION,
      catalogDefaultAction: null,
      catalogSource: null,
      catalogConfidence: null,
      catalogBreakageRisk: null,
      catalogRuleId: null,
      catalogNotes: null,
    };
  }

  if (rowSeed.relationship === "unknown") {
    return {
      category: "unknown",
      entity: null,
      explanation: UNKNOWN_REQUEST_EXPLANATION,
      catalogDefaultAction: null,
      catalogSource: null,
      catalogConfidence: null,
      catalogBreakageRisk: null,
      catalogRuleId: null,
      catalogNotes: null,
    };
  }

  const catalogMatch = lookupTrackerCatalogEntry(
    rowSeed.displayName,
    undefined,
    requestUrl,
  );

  return {
    category: catalogMatch?.entry.category ?? "unknown",
    entity: catalogMatch?.entry.entity ?? null,
    explanation:
      catalogMatch?.matchedRule?.explanation ??
      catalogMatch?.entry.explanation ??
      UNKNOWN_THIRD_PARTY_EXPLANATION,
    catalogDefaultAction: catalogMatch?.action ?? null,
    catalogSource: catalogMatch?.entry.source ?? null,
    catalogConfidence: catalogMatch?.entry.confidence ?? null,
    catalogBreakageRisk: catalogMatch?.entry.breakageRisk ?? null,
    catalogRuleId: catalogMatch?.matchedRule?.id ?? null,
    catalogNotes: catalogMatch?.entry.notes ?? null,
  };
}

function getDomainOverride(
  row: ObservedRequestRow,
  domainOverrides: Record<string, DomainOverrideAction> | undefined,
): DomainOverrideAction | null {
  if (!domainOverrides) {
    return null;
  }

  const overrideKey = row.host ?? row.displayName;

  return domainOverrides[overrideKey] ?? null;
}

function createStartedLifecycle(shouldBlock: boolean): RequestLifecycleCounts {
  return {
    ...EMPTY_LIFECYCLE_COUNTS,
    started: 1,
    blocked: shouldBlock ? 1 : 0,
  };
}

function buildRequestContextEvidence(
  evidence: RequestEvidence,
  relationship: RequestRelationship,
  requestType: RequestTypeCategory,
): RequestContextEvidence {
  return {
    frameIds: [evidence.frameId],
    frameContexts: [
      {
        frameId: evidence.frameId,
        parentFrameId:
          typeof evidence.parentFrameId === "number"
            ? evidence.parentFrameId
            : null,
        frameHost: getFrameHost(evidence),
        documentHost: formatUrlHost(evidence.documentUrl),
        relationship,
      },
    ],
    documentHosts: collectHosts(evidence.documentUrl, evidence.pageUrl),
    initiatorHosts: collectHosts(evidence.initiator, evidence.originUrl),
    pathHints: collectPathHints(evidence.requestUrl),
    visibilityNotes: inferVisibilityNotes(evidence, relationship, requestType),
  };
}

function mergeRequestContextEvidence(
  current: RequestContextEvidence,
  update: RequestContextEvidence,
): RequestContextEvidence {
  return {
    frameIds: mergeSortedNumbers(current.frameIds, update.frameIds),
    frameContexts: mergeFrameContexts(
      current.frameContexts,
      update.frameContexts,
    ),
    documentHosts: mergeSortedStrings(current.documentHosts, update.documentHosts),
    initiatorHosts: mergeSortedStrings(current.initiatorHosts, update.initiatorHosts),
    pathHints: mergeSortedStrings(current.pathHints, update.pathHints),
    visibilityNotes: mergeSortedStrings(
      current.visibilityNotes,
      update.visibilityNotes,
    ) as VisibilityNote[],
  };
}

function getFrameHost(evidence: RequestEvidence): string | null {
  if (evidence.requestType === "sub_frame") {
    return formatUrlHost(evidence.requestUrl);
  }

  return formatUrlHost(evidence.documentUrl);
}

function mergeFrameContexts(
  current: readonly RequestFrameContext[],
  update: readonly RequestFrameContext[],
): RequestFrameContext[] {
  const contextsByKey = new Map<string, RequestFrameContext>();

  for (const context of [...current, ...update]) {
    contextsByKey.set(formatFrameContextKey(context), context);
  }

  return [...contextsByKey.values()].sort(
    (left, right) =>
      left.frameId - right.frameId ||
      (left.parentFrameId ?? -1) - (right.parentFrameId ?? -1) ||
      (left.frameHost ?? "").localeCompare(right.frameHost ?? ""),
  );
}

function formatFrameContextKey(context: RequestFrameContext): string {
  return [
    context.frameId,
    context.parentFrameId ?? "",
    context.frameHost ?? "",
    context.documentHost ?? "",
    context.relationship,
  ].join("|");
}

function inferVisibilityNotes(
  evidence: RequestEvidence,
  relationship: RequestRelationship,
  requestType: RequestTypeCategory,
): VisibilityNote[] {
  const notes: VisibilityNote[] = ["visible-request"];

  if (relationship === "unknown") {
    notes.push("non-web-or-unclassifiable");
  }

  if (requestType === "beacon") {
    notes.push("exit-beacon-may-be-missed");
  }

  if (requestType === "websocket") {
    notes.push("websocket-frames-not-classified");
  }

  if (requestType === "prefetch") {
    notes.push("dns-or-preconnect-not-visible");
  }

  if (requestType === "xhr" || requestType === "beacon") {
    notes.push("headers-not-inspected");
  }

  if (evidence.frameId !== 0 || evidence.parentFrameId !== undefined) {
    notes.push("frame-ancestry-limited");
  }

  return mergeSortedStrings([], notes) as VisibilityNote[];
}

function collectHosts(
  ...urls: Array<string | null | undefined>
): string[] {
  return mergeSortedStrings(
    [],
    urls.map(formatUrlHost).filter((host): host is string => Boolean(host)),
  );
}

function collectPathHints(requestUrl?: string | null): string[] {
  if (!requestUrl) {
    return [];
  }

  try {
    const path = new URL(requestUrl).pathname.toLowerCase();
    const hints = [
      "collect",
      "track",
      "tracking",
      "event",
      "events",
      "beacon",
      "pixel",
      "conversion",
      "analytics",
      "telemetry",
    ];

    return hints.filter((hint) => path.includes(hint));
  } catch {
    return [];
  }
}

function mergeSortedStrings<T extends string>(
  current: readonly T[],
  update: readonly T[],
): T[] {
  return [...new Set([...current, ...update])].sort();
}

function mergeSortedNumbers(
  current: readonly number[],
  update: readonly number[],
): number[] {
  return [...new Set([...current, ...update])].sort((left, right) => left - right);
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
