import type { CatalogDefaultAction } from "./trackerCatalog";

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
export type DomainOverrideAction = "block" | "allow";
export type RuleDecisionRelationship =
  | "third-party"
  | "first-party"
  | "unknown";

export interface RuleDecisionInput {
  relationship: RuleDecisionRelationship;
  catalogDefaultAction?: CatalogDefaultAction | null;
  domainOverride?: DomainOverrideAction | null;
  sitePaused?: boolean;
}

export interface RuleDecision {
  status: RuleDecisionStatus;
  source: RuleDecisionSource;
  shouldBlock: boolean;
  shouldRestrictHeaders: boolean;
}

export function decideRule(input: RuleDecisionInput): RuleDecision {
  if (input.sitePaused) {
    return {
      status: "allowed-paused",
      source: "site-paused",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    };
  }

  if (input.domainOverride === "block") {
    return {
      status: "blocked",
      source: "blocked-by-user",
      shouldBlock: true,
      shouldRestrictHeaders: false,
    };
  }

  if (input.domainOverride === "allow") {
    return {
      status: "allowed",
      source: "allowed-by-user",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    };
  }

  if (input.relationship === "first-party") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    };
  }

  if (input.relationship === "unknown") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    };
  }

  if (input.catalogDefaultAction === "block") {
    return {
      status: "blocked",
      source: "automatic",
      shouldBlock: true,
      shouldRestrictHeaders: false,
    };
  }

  if (input.catalogDefaultAction === "restrict") {
    return {
      status: "restricted",
      source: "automatic",
      shouldBlock: false,
      shouldRestrictHeaders: true,
    };
  }

  if (input.catalogDefaultAction === "allow") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    };
  }

  return {
    status: "allowed",
    source: "automatic",
    shouldBlock: false,
    shouldRestrictHeaders: false,
  };
}
