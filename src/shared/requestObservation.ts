import { formatUrlHost } from "./domains";
import {
  UNKNOWN_THIRD_PARTY_EXPLANATION,
  type CatalogCategory,
  type CatalogDefaultAction,
  type TrackerCatalogEntry,
  type TrackerCatalogMatch,
} from "./trackerCatalog";
import {
  decideRequest,
  normalizeRequestContext,
  type DomainOverrideAction,
  type EasyPrivacyEvaluation,
  type RequestAction,
  type RequestDecision,
  type RequestDecisionReason,
  type RequestDecisionSource,
  type RequestRelationship,
} from "./requestDecisions";
import type { FilterRuleEvidence } from "./filterEngine";

export type { RequestRelationship } from "./requestDecisions";

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
  | "evidence-truncated"
  | "non-web-or-unclassifiable";

export interface RequestLifecycleCounts {
  started: number;
  completed: number;
  blocked: number;
  failed: number;
  redirected: number;
}

export interface RequestActionCounts {
  total: number;
  blocked: number;
  restricted: number;
  allowed: number;
}

export type RequestSourceCounts = Record<RequestDecisionSource, number>;

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
  catalogRuleIds: string[];
  catalogNotes: string | null;
  requestCount: number;
  actionCounts: RequestActionCounts;
  sourceCounts: RequestSourceCounts;
  isMixed: boolean;
  matchedFilterKeys: string[];
  matchedExceptionKeys: string[];
  decisionEvidenceTruncated: boolean;
  requestSampleCount: number;
  requestSamplesTruncated: boolean;
  redirectEvidenceTruncated: boolean;
  currentOverride: DomainOverrideAction | null;
  currentSiteAllow: boolean;
  requestTypes: RequestTypeCategory[];
  firstSeen: number;
  lastSeen: number;
  lifecycle: RequestLifecycleCounts;
  context: RequestContextEvidence;
  redirectHops: RequestRedirectHop[];
}

export interface TabRequestSummary {
  tabId: number;
  generation: number;
  siteUrl: string | null;
  siteHost: string | null;
  requestCounts: RequestActionCounts;
  hostCounts: {
    observed: number;
    thirdParty: number;
    unknown: number;
    firstParty: number;
    blocked: number;
    restricted: number;
    allowed: number;
    mixed: number;
    lowerBound: boolean;
  };
  hostRowsTruncated: boolean;
  omittedRequestCount: number;
  activeRequestEvidenceTruncated: boolean;
  rows: ObservedRequestRow[];
}

export interface TabObservationState {
  tabId: number;
  pageUrl: string | null;
  generation: number;
  rows: Map<string, ObservedRequestRow>;
  requestCounts: RequestActionCounts;
  omittedRequestCount: number;
  hostRowsTruncated: boolean;
  activeRequestEvidenceTruncated: boolean;
  activeRequests: Map<string, ActiveRequestAttempt>;
  requestSamples: Map<string, RequestAttemptExplanation[]>;
  nextRequestSampleId: number;
}

export interface ActiveRequestAttempt {
  requestId: string;
  tabId: number;
  attemptIndex: number;
  rowId: string | null;
  sampleId: string | null;
  decision: RequestDecision;
  startedAt: number;
}

export interface RequestAttemptExplanation {
  id: string;
  attemptIndex: number;
  action: RequestAction;
  source: RequestDecisionSource;
  reason: RequestDecisionReason;
  easyPrivacyEvaluation: EasyPrivacyEvaluation;
  relationship: RequestRelationship;
  requestType: RequestTypeCategory;
  sourceHost: string | null;
  pathHint: string | null;
  matchedFilter: FilterRuleEvidence | null;
  matchedException: FilterRuleEvidence | null;
  catalogEvidence: {
    entryId: string;
    ruleId: string | null;
    action: CatalogDefaultAction;
    explanation: string;
  } | null;
  startedAt: number;
  lastUpdatedAt: number;
  lifecycleStatus: RequestLifecycleStatus;
  redirectCount: number;
}

export interface HostRequestDetails {
  tabId: number;
  generation: number;
  rowId: string;
  host: string | null;
  displayName: string;
  samples: RequestAttemptExplanation[];
  truncated: boolean;
}

export interface RecordRequestOptions {
  catalog?: readonly TrackerCatalogEntry[];
  decision?: RequestDecision;
}

export interface RecordedRequest {
  row: ObservedRequestRow | null;
  shouldBlock: boolean;
}

export interface SummaryDecisionOptions {
  domainOverrides?: Record<string, DomainOverrideAction>;
  siteAllows?: Record<string, Record<string, true>>;
  siteHost?: string | null;
}

const FIRST_PARTY_EXPLANATION =
  "This request appears to belong to the current site.";
const UNKNOWN_REQUEST_EXPLANATION =
  "This request was observed, but Tracker Blocker could not classify its site relationship.";
const EMPTY_LIFECYCLE_COUNTS: RequestLifecycleCounts = {
  started: 0,
  completed: 0,
  blocked: 0,
  failed: 0,
  redirected: 0,
};
const EMPTY_ACTION_COUNTS: RequestActionCounts = {
  total: 0,
  blocked: 0,
  restricted: 0,
  allowed: 0,
};
const RELATIONSHIP_ORDER: Record<RequestRelationship, number> = {
  "third-party": 0,
  unknown: 1,
  "first-party": 2,
};
const CATALOG_ACTION_PRIORITY: Record<CatalogDefaultAction, number> = {
  allow: 0,
  restrict: 1,
  block: 2,
};
const EMPTY_WEB_AUTHORITY_PATTERN = /^(?:https?|wss?):\/\/[/?#]/i;
const SAFE_PATH_SEGMENTS = new Set([
  "a",
  "api",
  "asset",
  "assets",
  "beacon",
  "collect",
  "collection",
  "conversion",
  "embed",
  "event",
  "events",
  "g",
  "pixel",
  "script",
  "track",
  "tracking",
  "telemetry",
  "user",
  "users",
  "v1",
  "v2",
  "v3",
]);
const SAFE_RESOURCE_BASENAMES = new Set([
  "analytics",
  "asset",
  "beacon",
  "collect",
  "embed",
  "event",
  "pixel",
  "script",
  "telemetry",
  "track",
]);
const MAX_REQUEST_CONTEXT_VALUES = 16;
export const MAX_ACTIVE_REQUESTS_PER_TAB = 512;
export const MAX_ACTIVE_REQUESTS_GLOBAL = 4_096;
export const MAX_ACTIVE_REQUEST_AGE_MS = 10 * 60 * 1_000;
export const MAX_HOST_ROWS_PER_TAB = 256;
export const MAX_MATCHED_FILTER_IDS = 8;
export const MAX_MATCHED_EXCEPTION_IDS = 8;
export const MAX_CATALOG_RULE_IDS = 16;
export const MAX_REDIRECT_HOPS = 8;
export const MAX_REQUEST_SAMPLES_PER_HOST = 6;

export function createTabObservationState(
  tabId: number,
  pageUrl?: string | null,
): TabObservationState {
  return {
    tabId,
    pageUrl: pageUrl ?? null,
    generation: 0,
    rows: new Map(),
    requestCounts: { ...EMPTY_ACTION_COUNTS },
    omittedRequestCount: 0,
    hostRowsTruncated: false,
    activeRequestEvidenceTruncated: false,
    activeRequests: new Map(),
    requestSamples: new Map(),
    nextRequestSampleId: 0,
  };
}

export function resetTabObservationState(
  state: TabObservationState,
  pageUrl?: string | null,
): void {
  state.generation += 1;
  state.pageUrl = pageUrl ?? null;
  state.rows.clear();
  state.requestCounts = { ...EMPTY_ACTION_COUNTS };
  state.omittedRequestCount = 0;
  state.hostRowsTruncated = false;
  state.activeRequestEvidenceTruncated = false;
  state.activeRequests.clear();
  state.requestSamples.clear();
  state.nextRequestSampleId = 0;
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
  options: RecordRequestOptions = {},
): RecordedRequest {
  const pageUrl = state.pageUrl ?? evidence.pageUrl;
  const requestContext = normalizeRequestContext({
    requestId: evidence.requestId,
    tabId: evidence.tabId,
    pageUrl,
    documentUrl: evidence.documentUrl,
    originUrl: evidence.originUrl,
    initiator: evidence.initiator,
    requestUrl: evidence.requestUrl,
    requestType: evidence.requestType,
  });
  const requestType = mapRequestType(evidence.requestType);
  const rowSeed: {
    relationship: RequestRelationship;
    key: string;
    host: string | null;
    siteDomain: string | null;
    displayName: string;
  } = requestContext.requestHost
    ? {
        relationship: requestContext.relationship,
        key: requestContext.requestHost,
        host: requestContext.requestHost,
        siteDomain: requestContext.requestSite,
        displayName: requestContext.requestHost,
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
  const requestDecision =
    options.decision ??
    decideRequest({
      context: requestContext,
      sitePaused: evidence.sitePaused,
      domainOverrides: evidence.domainOverrides,
      catalog: options.catalog,
    });
  const shouldBlock = requestDecision.action === "block";
  const actionUpdate = createActionCounts(requestDecision.action);
  state.requestCounts = mergeActionCounts(state.requestCounts, actionUpdate);
  pruneStaleActiveRequests(state, evidence.timestamp);

  if (!existing && state.rows.size >= MAX_HOST_ROWS_PER_TAB) {
    state.hostRowsTruncated = true;
    state.omittedRequestCount += 1;
    rememberActiveRequest(
      state,
      evidence.requestId,
      null,
      requestDecision,
      evidence.timestamp,
    );
    return { row: null, shouldBlock };
  }

  const catalogFields = getCatalogFields(rowSeed, requestDecision.catalogMatch);
  const contextUpdate = buildRequestContextEvidence(
    evidence,
    rowSeed.relationship,
    requestType,
  );
  const lifecycleUpdate = createStartedLifecycle(shouldBlock);
  const filterKeys = requestDecision.matchedFilter
    ? [requestDecision.matchedFilter.key]
    : [];
  const exceptionKeys = requestDecision.matchedException
    ? [requestDecision.matchedException.key]
    : [];

  if (!existing) {
    const row: ObservedRequestRow = {
      id,
      host: rowSeed.host,
      siteDomain: rowSeed.siteDomain,
      displayName: rowSeed.displayName,
      relationship: rowSeed.relationship,
      ...catalogFields,
      requestCount: 1,
      actionCounts: actionUpdate,
      sourceCounts: createSourceCounts(requestDecision.source),
      isMixed: false,
      matchedFilterKeys: filterKeys,
      matchedExceptionKeys: exceptionKeys,
      decisionEvidenceTruncated: false,
      requestSampleCount: 0,
      requestSamplesTruncated: false,
      redirectEvidenceTruncated: false,
      currentOverride: evidence.domainOverrides?.[rowSeed.key] ?? null,
      currentSiteAllow: false,
      requestTypes: [requestType],
      firstSeen: evidence.timestamp,
      lastSeen: evidence.timestamp,
      lifecycle: lifecycleUpdate,
      context: contextUpdate,
      redirectHops: [],
    };

    state.rows.set(id, row);
    rememberActiveRequest(
      state,
      evidence.requestId,
      id,
      requestDecision,
      evidence.timestamp,
      createRequestSampleInput(evidence, requestContext, requestType),
    );
    return { row, shouldBlock };
  }

  existing.requestCount += 1;
  existing.actionCounts = mergeActionCounts(
    existing.actionCounts,
    actionUpdate,
  );
  existing.sourceCounts = mergeSourceCounts(
    existing.sourceCounts,
    requestDecision.source,
  );
  existing.isMixed = hasMixedActions(existing.actionCounts);
  existing.lastSeen = Math.max(existing.lastSeen, evidence.timestamp);
  mergeCatalogFields(existing, catalogFields);
  existing.currentOverride = evidence.domainOverrides?.[rowSeed.key] ?? null;
  const mergedFilters = mergeBoundedStrings(
    existing.matchedFilterKeys,
    filterKeys,
    MAX_MATCHED_FILTER_IDS,
  );
  const mergedExceptions = mergeBoundedStrings(
    existing.matchedExceptionKeys,
    exceptionKeys,
    MAX_MATCHED_EXCEPTION_IDS,
  );
  existing.matchedFilterKeys = mergedFilters.values;
  existing.matchedExceptionKeys = mergedExceptions.values;
  existing.decisionEvidenceTruncated ||=
    mergedFilters.truncated || mergedExceptions.truncated;
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

  rememberActiveRequest(
    state,
    evidence.requestId,
    id,
    requestDecision,
    evidence.timestamp,
    createRequestSampleInput(evidence, requestContext, requestType),
  );
  return { row: existing, shouldBlock };
}

export function recordUnobservedRequestAttempt(
  state: TabObservationState,
  requestId: string | null | undefined,
  decision: RequestDecision,
  timestamp: number,
): void {
  pruneStaleActiveRequests(state, timestamp);
  rememberActiveRequest(state, requestId, null, decision, timestamp);
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
  const redirectUpdate = appendRedirectHop(row.redirectHops, {
    fromHost: formatUrlHost(evidence.fromUrl),
    toHost: formatUrlHost(evidence.redirectUrl),
    statusCode:
      typeof evidence.statusCode === "number" ? evidence.statusCode : null,
    timestamp: evidence.timestamp,
  });
  row.redirectHops = redirectUpdate.values;
  row.redirectEvidenceTruncated ||= redirectUpdate.truncated;
  updateAttemptSample(state, evidence.requestId, evidence.timestamp, (sample) => ({
    ...sample,
    lifecycleStatus: "redirected",
    redirectCount: sample.redirectCount + 1,
  }));

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
  const attempt = getActiveRequestAttempt(state, evidence.requestId);

  if (evidence.requestId) {
    state.activeRequests.delete(evidence.requestId);
  }

  const row = attempt?.rowId
    ? state.rows.get(attempt.rowId) ?? null
    : null;

  if (!row || !attempt) {
    return null;
  }

  row.lastSeen = Math.max(row.lastSeen, evidence.timestamp);
  if (!(lifecycleStatus === "failed" && attempt.decision.action === "block")) {
    row.lifecycle = mergeLifecycleCounts(row.lifecycle, {
      [lifecycleStatus]: 1,
    });
  }
  updateRequestSample(state, attempt, evidence.timestamp, (sample) => ({
    ...sample,
    lifecycleStatus:
      lifecycleStatus === "failed" && attempt.decision.action === "block"
        ? "blocked"
        : lifecycleStatus,
  }));

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

function rememberActiveRequest(
  state: TabObservationState,
  requestId: string | null | undefined,
  rowId: string | null,
  decision: RequestDecision,
  startedAt: number,
  sampleInput?: RequestSampleInput,
): void {
  const existing = requestId ? state.activeRequests.get(requestId) : undefined;

  if (
    requestId &&
    !existing &&
    state.activeRequests.size >= MAX_ACTIVE_REQUESTS_PER_TAB
  ) {
    evictOldestActiveRequest(state);
  }

  const attemptIndex = existing ? existing.attemptIndex + 1 : 0;
  const sampleId = rowId && sampleInput
    ? rememberRequestSample(
        state,
        rowId,
        decision,
        attemptIndex,
        startedAt,
        sampleInput,
      )
    : null;

  if (!requestId) {
    return;
  }

  state.activeRequests.set(requestId, {
    requestId,
    tabId: state.tabId,
    attemptIndex,
    rowId,
    sampleId,
    decision,
    startedAt,
  });
}

interface RequestSampleInput {
  requestType: RequestTypeCategory;
  sourceHost: string | null;
  pathHint: string | null;
}

function createRequestSampleInput(
  evidence: RequestEvidence,
  context: ReturnType<typeof normalizeRequestContext>,
  requestType: RequestTypeCategory,
): RequestSampleInput {
  return {
    requestType,
    sourceHost: formatUrlHost(context.sourceUrl),
    pathHint: formatPrivacySafePathHint(evidence.requestUrl),
  };
}

function rememberRequestSample(
  state: TabObservationState,
  rowId: string,
  decision: RequestDecision,
  attemptIndex: number,
  startedAt: number,
  input: RequestSampleInput,
): string | null {
  const row = state.rows.get(rowId);

  if (!row) {
    return null;
  }

  const sample: RequestAttemptExplanation = {
    id: `sample-${state.nextRequestSampleId++}`,
    attemptIndex,
    action: decision.action,
    source: decision.source,
    reason: decision.reason,
    easyPrivacyEvaluation: decision.easyPrivacyEvaluation,
    relationship: decision.relationship,
    requestType: input.requestType,
    sourceHost: input.sourceHost,
    pathHint: input.pathHint,
    matchedFilter: decision.matchedFilter,
    matchedException: decision.matchedException,
    catalogEvidence: decision.catalogMatch
      ? {
          entryId: decision.catalogMatch.entry.id,
          ruleId: decision.catalogMatch.matchedRule?.id ?? null,
          action: decision.catalogMatch.action,
          explanation:
            decision.catalogMatch.matchedRule?.explanation ??
            decision.catalogMatch.entry.explanation,
        }
      : null,
    startedAt,
    lastUpdatedAt: startedAt,
    lifecycleStatus: decision.action === "block" ? "blocked" : "started",
    redirectCount: 0,
  };
  const current = state.requestSamples.get(rowId) ?? [];

  if (current.length < MAX_REQUEST_SAMPLES_PER_HOST) {
    state.requestSamples.set(rowId, [...current, sample]);
    row.requestSampleCount += 1;
    return sample.id;
  }

  row.requestSamplesTruncated = true;
  const replacementIndex = chooseRequestSampleReplacement(current, sample);

  if (replacementIndex < 0) {
    return null;
  }

  const next = [...current];
  next[replacementIndex] = sample;
  state.requestSamples.set(rowId, next);
  return sample.id;
}

function chooseRequestSampleReplacement(
  current: readonly RequestAttemptExplanation[],
  incoming: RequestAttemptExplanation,
): number {
  const duplicateIndex = current.findIndex(
    (sample) => formatSampleSignature(sample) === formatSampleSignature(incoming),
  );

  if (duplicateIndex >= 0) {
    return duplicateIndex;
  }

  const ranked = current
    .map((sample, index) => ({
      index,
      priority: getRequestSamplePriority(sample),
      startedAt: sample.startedAt,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority || left.startedAt - right.startedAt,
    );
  const lowest = ranked[0];

  return lowest && getRequestSamplePriority(incoming) > lowest.priority
    ? lowest.index
    : -1;
}

function getRequestSamplePriority(sample: RequestAttemptExplanation): number {
  if (sample.matchedException) {
    return 5;
  }

  if (sample.action === "block") {
    return 4;
  }

  if (sample.action === "restrict") {
    return 3;
  }

  return sample.source === "default" ? 1 : 2;
}

function formatSampleSignature(sample: RequestAttemptExplanation): string {
  return [
    sample.action,
    sample.source,
    sample.reason,
    sample.requestType,
    sample.pathHint ?? "",
    sample.matchedFilter?.key ?? "",
    sample.matchedException?.key ?? "",
  ].join("|");
}

function updateAttemptSample(
  state: TabObservationState,
  requestId: string | null | undefined,
  timestamp: number,
  update: (sample: RequestAttemptExplanation) => RequestAttemptExplanation,
): void {
  const attempt = getActiveRequestAttempt(state, requestId);

  if (attempt) {
    updateRequestSample(state, attempt, timestamp, update);
  }
}

function updateRequestSample(
  state: TabObservationState,
  attempt: ActiveRequestAttempt,
  timestamp: number,
  update: (sample: RequestAttemptExplanation) => RequestAttemptExplanation,
): void {
  if (!attempt.rowId || !attempt.sampleId) {
    return;
  }

  const samples = state.requestSamples.get(attempt.rowId);
  const index = samples?.findIndex((sample) => sample.id === attempt.sampleId) ?? -1;

  if (!samples || index < 0) {
    return;
  }

  const next = [...samples];
  next[index] = {
    ...update(samples[index]),
    lastUpdatedAt: timestamp,
  };
  state.requestSamples.set(attempt.rowId, next);
}

export function getActiveRequestAttempt(
  state: TabObservationState,
  requestId: string | null | undefined,
): ActiveRequestAttempt | null {
  return requestId ? state.activeRequests.get(requestId) ?? null : null;
}

export function getActiveRequestDecision(
  state: TabObservationState | undefined,
  requestId: string | null | undefined,
): RequestDecision | null {
  return state ? getActiveRequestAttempt(state, requestId)?.decision ?? null : null;
}

function getRowForRequestId(
  state: TabObservationState,
  requestId: string | null | undefined,
): ObservedRequestRow | null {
  if (!requestId) {
    return null;
  }

  const attempt = state.activeRequests.get(requestId);

  return attempt?.rowId ? state.rows.get(attempt.rowId) ?? null : null;
}

export function enforceGlobalActiveRequestLimit(
  states: Iterable<TabObservationState>,
): void {
  const stateList = [...states];
  const total = stateList.reduce(
    (count, state) => count + state.activeRequests.size,
    0,
  );

  if (total <= MAX_ACTIVE_REQUESTS_GLOBAL) {
    return;
  }

  const active = stateList.flatMap((state) =>
    [...state.activeRequests.values()].map((attempt) => ({ state, attempt })),
  );

  active
    .sort((left, right) => left.attempt.startedAt - right.attempt.startedAt)
    .slice(0, active.length - MAX_ACTIVE_REQUESTS_GLOBAL)
    .forEach(({ state, attempt }) => {
      evictActiveRequest(state, attempt.requestId);
    });
}

function pruneStaleActiveRequests(
  state: TabObservationState,
  now: number,
): void {
  for (const attempt of state.activeRequests.values()) {
    if (now - attempt.startedAt > MAX_ACTIVE_REQUEST_AGE_MS) {
      evictActiveRequest(state, attempt.requestId);
    }
  }
}

function evictOldestActiveRequest(state: TabObservationState): void {
  const oldest = [...state.activeRequests.values()].sort(
    (left, right) => left.startedAt - right.startedAt,
  )[0];

  if (oldest) {
    evictActiveRequest(state, oldest.requestId);
  }
}

function evictActiveRequest(
  state: TabObservationState,
  requestId: string,
): void {
  const attempt = state.activeRequests.get(requestId);

  if (!attempt) {
    return;
  }

  state.activeRequests.delete(requestId);
  state.activeRequestEvidenceTruncated = true;

  if (attempt.rowId) {
    const row = state.rows.get(attempt.rowId);

    if (row && !row.context.visibilityNotes.includes("evidence-truncated")) {
      row.context.visibilityNotes = [
        ...row.context.visibilityNotes,
        "evidence-truncated",
      ].sort() as VisibilityNote[];
    }
  }
}

function appendRedirectHop(
  current: readonly RequestRedirectHop[],
  hop: RequestRedirectHop,
): { values: RequestRedirectHop[]; truncated: boolean } {
  const next = [...current, hop];

  return {
    values: next.slice(-MAX_REDIRECT_HOPS),
    truncated: next.length > MAX_REDIRECT_HOPS,
  };
}

export function summarizeTabObservation(
  state: TabObservationState,
  decisionOptions: SummaryDecisionOptions = {},
): TabRequestSummary {
  const rows = [...state.rows.values()]
    .map((row) =>
      applyRowDecision(row, {
        ...decisionOptions,
        siteHost: decisionOptions.siteHost ?? formatUrlHost(state.pageUrl),
      }),
    )
    .sort(compareObservedRows);

  return {
    tabId: state.tabId,
    generation: state.generation,
    siteUrl: state.pageUrl,
    siteHost: formatUrlHost(state.pageUrl),
    requestCounts: { ...state.requestCounts },
    hostCounts: {
      observed: rows.length,
      thirdParty: rows.filter((row) => row.relationship === "third-party")
        .length,
      unknown: rows.filter(isUnknownRow).length,
      firstParty: rows.filter((row) => row.relationship === "first-party")
        .length,
      blocked: rows.filter((row) => row.actionCounts.blocked > 0).length,
      restricted: rows.filter((row) => row.actionCounts.restricted > 0).length,
      allowed: rows.filter((row) => row.actionCounts.allowed > 0).length,
      mixed: rows.filter((row) => row.isMixed).length,
      lowerBound: state.hostRowsTruncated,
    },
    hostRowsTruncated: state.hostRowsTruncated,
    omittedRequestCount: state.omittedRequestCount,
    activeRequestEvidenceTruncated: state.activeRequestEvidenceTruncated,
    rows,
  };
}

export function summarizeHostRequestDetails(
  state: TabObservationState,
  generation: number,
  rowId: string,
): HostRequestDetails | null {
  if (generation !== state.generation) {
    return null;
  }

  const row = state.rows.get(rowId);

  if (!row) {
    return null;
  }

  return {
    tabId: state.tabId,
    generation: state.generation,
    rowId,
    host: row.host,
    displayName: row.displayName,
    samples: [...(state.requestSamples.get(rowId) ?? [])]
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((sample) => ({ ...sample })),
    truncated: row.requestSamplesTruncated,
  };
}

function applyRowDecision(
  row: ObservedRequestRow,
  decisionOptions: SummaryDecisionOptions,
): ObservedRequestRow {
  return {
    ...row,
    currentOverride: getDomainOverride(
      row,
      decisionOptions.domainOverrides,
    ),
    currentSiteAllow: getSiteAllow(row, decisionOptions),
  };
}

function getSiteAllow(
  row: ObservedRequestRow,
  decisionOptions: SummaryDecisionOptions,
): boolean {
  return Boolean(
    decisionOptions.siteHost &&
      row.host &&
      decisionOptions.siteAllows?.[decisionOptions.siteHost]?.[row.host] ===
        true,
  );
}

export function isUnknownRow(row: ObservedRequestRow): boolean {
  return (
    row.relationship === "unknown" ||
    (row.relationship === "third-party" && row.category === "unknown")
  );
}

type CatalogFields = Pick<
  ObservedRequestRow,
  | "category"
  | "entity"
  | "explanation"
  | "catalogDefaultAction"
  | "catalogSource"
  | "catalogConfidence"
  | "catalogBreakageRisk"
  | "catalogRuleIds"
  | "catalogNotes"
>;

function getCatalogFields(
  rowSeed: {
    relationship: RequestRelationship;
    displayName: string;
  },
  catalogMatch: TrackerCatalogMatch | null,
): CatalogFields {
  if (rowSeed.relationship === "first-party") {
    return {
      category: "unknown",
      entity: null,
      explanation: FIRST_PARTY_EXPLANATION,
      catalogDefaultAction: null,
      catalogSource: null,
      catalogConfidence: null,
      catalogBreakageRisk: null,
      catalogRuleIds: [],
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
      catalogRuleIds: [],
      catalogNotes: null,
    };
  }

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
    catalogRuleIds: catalogMatch?.matchedRule
      ? [catalogMatch.matchedRule.id]
      : [],
    catalogNotes: catalogMatch?.entry.notes ?? null,
  };
}

function mergeCatalogFields(
  row: ObservedRequestRow,
  update: CatalogFields,
): void {
  const currentPriority = row.catalogDefaultAction
    ? CATALOG_ACTION_PRIORITY[row.catalogDefaultAction]
    : -1;
  const updatePriority = update.catalogDefaultAction
    ? CATALOG_ACTION_PRIORITY[update.catalogDefaultAction]
    : -1;
  const shouldUseUpdate =
    updatePriority > currentPriority ||
    (updatePriority === currentPriority &&
      row.catalogRuleIds.length === 0 &&
      update.catalogRuleIds.length > 0);

  const mergedRuleIds = mergeBoundedStrings(
    row.catalogRuleIds,
    update.catalogRuleIds,
    MAX_CATALOG_RULE_IDS,
  );
  row.catalogRuleIds = mergedRuleIds.values;
  row.decisionEvidenceTruncated ||= mergedRuleIds.truncated;

  if (!shouldUseUpdate) {
    return;
  }

  row.category = update.category;
  row.entity = update.entity;
  row.explanation = update.explanation;
  row.catalogDefaultAction = update.catalogDefaultAction;
  row.catalogSource = update.catalogSource;
  row.catalogConfidence = update.catalogConfidence;
  row.catalogBreakageRisk = update.catalogBreakageRisk;
  row.catalogNotes = update.catalogNotes;
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
  const frameIds = mergeSortedNumbers(current.frameIds, update.frameIds);
  const frameContexts = mergeFrameContexts(
    current.frameContexts,
    update.frameContexts,
  );
  const documentHosts = mergeSortedStrings(
    current.documentHosts,
    update.documentHosts,
  );
  const initiatorHosts = mergeSortedStrings(
    current.initiatorHosts,
    update.initiatorHosts,
  );
  const wasTruncated = [
    frameIds,
    frameContexts,
    documentHosts,
    initiatorHosts,
  ].some((values) => values.length > MAX_REQUEST_CONTEXT_VALUES);

  return {
    frameIds: frameIds.slice(0, MAX_REQUEST_CONTEXT_VALUES),
    frameContexts: frameContexts.slice(0, MAX_REQUEST_CONTEXT_VALUES),
    documentHosts: documentHosts.slice(0, MAX_REQUEST_CONTEXT_VALUES),
    initiatorHosts: initiatorHosts.slice(0, MAX_REQUEST_CONTEXT_VALUES),
    pathHints: mergeSortedStrings(current.pathHints, update.pathHints),
    visibilityNotes: mergeSortedStrings(
      current.visibilityNotes,
      wasTruncated
        ? [...update.visibilityNotes, "evidence-truncated"]
        : update.visibilityNotes,
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

export function formatPrivacySafePathHint(
  requestUrl?: string | null,
): string | null {
  if (!requestUrl) {
    return null;
  }

  try {
    const pathname = new URL(requestUrl).pathname;
    const segments = pathname
      .split("/")
      .filter(Boolean)
      .slice(0, 4)
      .map(sanitizePathSegment);

    if (segments.length === 0) {
      return "/";
    }

    const hint = `/${segments.join("/")}`;
    return hint.length <= 96 ? hint : `${hint.slice(0, 95)}…`;
  } catch {
    return null;
  }
}

function sanitizePathSegment(segment: string): string {
  const normalized = segment.toLowerCase();
  const looksSensitive =
    /%40|@/.test(normalized) ||
    /\b\d{5,}\b/.test(normalized) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalized) ||
    /^[a-z0-9_-]{20,}$/i.test(normalized);

  if (looksSensitive) {
    return "…";
  }

  if (SAFE_PATH_SEGMENTS.has(normalized)) {
    return normalized;
  }

  const resourceMatch = /^([a-z0-9_-]+)\.(js|css|gif|png|svg|webp|woff2?)$/i.exec(
    normalized,
  );
  if (resourceMatch) {
    return SAFE_RESOURCE_BASENAMES.has(resourceMatch[1])
      ? normalized
      : `….${resourceMatch[2]}`;
  }

  return "…";
}

function createActionCounts(action: RequestAction): RequestActionCounts {
  return {
    total: 1,
    blocked: action === "block" ? 1 : 0,
    restricted: action === "restrict" ? 1 : 0,
    allowed: action === "allow" ? 1 : 0,
  };
}

function mergeActionCounts(
  current: RequestActionCounts,
  update: RequestActionCounts,
): RequestActionCounts {
  return {
    total: current.total + update.total,
    blocked: current.blocked + update.blocked,
    restricted: current.restricted + update.restricted,
    allowed: current.allowed + update.allowed,
  };
}

function createSourceCounts(
  source: RequestDecisionSource,
): RequestSourceCounts {
  return mergeSourceCounts(
    {
      "site-pause": 0,
      "site-allow": 0,
      "user-block": 0,
      "user-allow": 0,
      "settings-unavailable": 0,
      easyprivacy: 0,
      catalog: 0,
      default: 0,
    },
    source,
  );
}

function mergeSourceCounts(
  current: RequestSourceCounts,
  source: RequestDecisionSource,
): RequestSourceCounts {
  return {
    ...current,
    [source]: current[source] + 1,
  };
}

function hasMixedActions(counts: RequestActionCounts): boolean {
  return [counts.blocked, counts.restricted, counts.allowed].filter(
    (count) => count > 0,
  ).length > 1;
}

function mergeBoundedStrings<T extends string>(
  current: readonly T[],
  update: readonly T[],
  limit: number,
): { values: T[]; truncated: boolean } {
  const merged = mergeSortedStrings(current, update);

  return {
    values: merged.slice(0, limit),
    truncated: merged.length > limit,
  };
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
