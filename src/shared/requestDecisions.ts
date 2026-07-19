import { classifyRequestSiteRelationship } from "./domains";
import type { FilterMatchResult, FilterRuleEvidence } from "./filterEngine";
import {
  lookupTrackerCatalogEntry,
  type CatalogDefaultAction,
  type TrackerCatalogEntry,
  type TrackerCatalogMatch,
} from "./trackerCatalog";

export type RequestAction = "allow" | "block" | "restrict";
export type RequestDecisionSource =
  | "site-pause"
  | "user-block"
  | "user-allow"
  | "settings-unavailable"
  | "easyprivacy"
  | "catalog"
  | "default";
export type RequestRelationship = "third-party" | "first-party" | "unknown";
export type DomainOverrideAction = "block" | "allow";

export type RuleDecisionStatus =
  | "blocked"
  | "restricted"
  | "allowed"
  | "allowed-paused";
export type RuleDecisionSource =
  | "automatic"
  | "blocked-by-user"
  | "allowed-by-user"
  | "site-paused";

export interface RequestHeaderRestriction {
  removeHeaders: readonly ["cookie", "referer"];
}

export interface RawRequestContext {
  requestId?: string | null;
  tabId: number;
  pageUrl?: string | null;
  documentUrl?: string | null;
  originUrl?: string | null;
  initiator?: string | null;
  requestUrl?: string | null;
  requestType?: string | null;
}

export interface NormalizedRequestContext {
  requestId: string;
  tabId: number;
  pageUrl: string | null;
  requestUrl: string;
  requestType: string;
  sourceUrl: string | null;
  requestHost: string | null;
  requestSite: string | null;
  relationship: RequestRelationship;
}

export interface RequestDecision {
  requestId: string;
  tabId: number;
  action: RequestAction;
  source: RequestDecisionSource;
  relationship: RequestRelationship;
  requestHost: string | null;
  matchedFilter: FilterRuleEvidence | null;
  matchedException: FilterRuleEvidence | null;
  catalogMatch: TrackerCatalogMatch | null;
  headerRestriction: RequestHeaderRestriction | null;
}

export interface RequestDecisionInput {
  context: NormalizedRequestContext;
  sitePaused?: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
  catalog?: readonly TrackerCatalogEntry[];
  easyPrivacyEnabled?: boolean;
  filterMatch?: FilterMatchResult | null;
  automaticPolicy?: "enabled" | "disabled";
}

export interface RequestPolicyInput {
  relationship: RequestRelationship;
  sitePaused?: boolean;
  domainOverride?: DomainOverrideAction | null;
  catalogDefaultAction?: CatalogDefaultAction | null;
  easyPrivacyEnabled?: boolean;
  filterMatch?: FilterMatchResult | null;
  automaticPolicy?: "enabled" | "disabled";
}

export interface RuleDecisionPresentation {
  status: RuleDecisionStatus;
  source: RuleDecisionSource;
  shouldBlock: boolean;
  shouldRestrictHeaders: boolean;
}

const TRACKING_HEADER_RESTRICTION: RequestHeaderRestriction = Object.freeze({
  removeHeaders: ["cookie", "referer"] as const,
});

export function normalizeRequestContext(
  input: RawRequestContext,
): NormalizedRequestContext {
  const pageUrl = normalizeOptionalString(input.pageUrl);
  const requestUrl = normalizeOptionalString(input.requestUrl) ?? "";
  const classification = classifyRequestSiteRelationship({
    pageUrl,
    requestUrl,
  });
  const classified =
    classification.status === "same-site" ||
    classification.status === "third-party";

  return {
    requestId: normalizeOptionalString(input.requestId) ?? "",
    tabId: input.tabId,
    pageUrl,
    requestUrl,
    requestType: normalizeOptionalString(input.requestType) ?? "other",
    sourceUrl:
      normalizeOptionalString(input.documentUrl) ??
      normalizeOptionalString(input.originUrl) ??
      normalizeOptionalString(input.initiator) ??
      pageUrl,
    requestHost: classified ? classification.requestHost : null,
    requestSite: classified ? classification.requestSite : null,
    relationship: classified
      ? classification.status === "third-party"
        ? "third-party"
        : "first-party"
      : "unknown",
  };
}

export function decideRequest(input: RequestDecisionInput): RequestDecision {
  const { context } = input;
  const domainOverride = context.requestHost
    ? input.domainOverrides?.[context.requestHost] ?? null
    : null;
  const catalogMatch =
    context.relationship === "third-party"
      ? lookupTrackerCatalogEntry(
          context.requestHost,
          input.catalog,
          context.requestUrl,
        )
      : null;
  const policy = decideRequestPolicy({
    relationship: context.relationship,
    sitePaused: input.sitePaused,
    domainOverride,
    catalogDefaultAction: catalogMatch?.action ?? null,
    easyPrivacyEnabled: input.easyPrivacyEnabled,
    filterMatch: input.filterMatch,
    automaticPolicy: input.automaticPolicy,
  });

  return {
    requestId: context.requestId,
    tabId: context.tabId,
    relationship: context.relationship,
    requestHost: context.requestHost,
    catalogMatch,
    ...policy,
  };
}

export function decideMainFrameRequest(
  input: Pick<
    RequestDecisionInput,
    "context" | "sitePaused" | "domainOverrides"
  >,
): RequestDecision {
  return decideRequest({
    ...input,
    automaticPolicy: "disabled",
  });
}

export function decideRequestPolicy(input: RequestPolicyInput): Pick<
  RequestDecision,
  | "action"
  | "source"
  | "matchedFilter"
  | "matchedException"
  | "headerRestriction"
> {
  if (input.sitePaused) {
    return createPolicyDecision("allow", "site-pause");
  }

  if (input.domainOverride === "block") {
    return createPolicyDecision("block", "user-block");
  }

  if (input.domainOverride === "allow") {
    return createPolicyDecision("allow", "user-allow");
  }

  if (input.automaticPolicy === "disabled") {
    return createPolicyDecision("allow", "default");
  }

  if (input.easyPrivacyEnabled && input.filterMatch?.outcome === "exception") {
    return createPolicyDecision(
      "allow",
      "easyprivacy",
      input.filterMatch.matchedFilter,
      input.filterMatch.matchedException,
    );
  }

  if (input.easyPrivacyEnabled && input.filterMatch?.outcome === "block") {
    return createPolicyDecision(
      "block",
      "easyprivacy",
      input.filterMatch.matchedFilter,
    );
  }

  if (input.relationship !== "third-party") {
    return createPolicyDecision("allow", "default");
  }

  if (input.catalogDefaultAction === "block") {
    return createPolicyDecision("block", "catalog");
  }

  if (input.catalogDefaultAction === "restrict") {
    return {
      ...createPolicyDecision("restrict", "catalog"),
      headerRestriction: TRACKING_HEADER_RESTRICTION,
    };
  }

  if (input.catalogDefaultAction === "allow") {
    return createPolicyDecision("allow", "catalog");
  }

  return createPolicyDecision("allow", "default");
}

export function createSettingsUnavailableDecision(
  context: NormalizedRequestContext,
): RequestDecision {
  return {
    requestId: context.requestId,
    tabId: context.tabId,
    action: "allow",
    source: "settings-unavailable",
    relationship: context.relationship,
    requestHost: context.requestHost,
    matchedFilter: null,
    matchedException: null,
    catalogMatch: null,
    headerRestriction: null,
  };
}

export function toRuleDecisionPresentation(
  decision: Pick<RequestDecision, "action" | "source">,
): RuleDecisionPresentation {
  return {
    status:
      decision.source === "site-pause"
        ? "allowed-paused"
        : decision.action === "block"
          ? "blocked"
          : decision.action === "restrict"
            ? "restricted"
            : "allowed",
    source:
      decision.source === "site-pause"
        ? "site-paused"
        : decision.source === "user-block"
          ? "blocked-by-user"
          : decision.source === "user-allow"
            ? "allowed-by-user"
            : "automatic",
    shouldBlock: decision.action === "block",
    shouldRestrictHeaders: decision.action === "restrict",
  };
}

function createPolicyDecision(
  action: RequestAction,
  source: RequestDecisionSource,
  matchedFilter: FilterRuleEvidence | null = null,
  matchedException: FilterRuleEvidence | null = null,
): Pick<
  RequestDecision,
  | "action"
  | "source"
  | "matchedFilter"
  | "matchedException"
  | "headerRestriction"
> {
  return {
    action,
    source,
    matchedFilter,
    matchedException,
    headerRestriction: null,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
