import type { CatalogDefaultAction } from "./trackerCatalog";

export type RuleDecisionStatus = "blocked" | "allowed" | "allowed-paused";
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
}

export function decideRule(input: RuleDecisionInput): RuleDecision {
  if (input.sitePaused) {
    return {
      status: "allowed-paused",
      source: "site-paused",
      shouldBlock: false,
    };
  }

  if (input.domainOverride === "block") {
    return {
      status: "blocked",
      source: "blocked-by-user",
      shouldBlock: true,
    };
  }

  if (input.domainOverride === "allow") {
    return {
      status: "allowed",
      source: "allowed-by-user",
      shouldBlock: false,
    };
  }

  if (input.relationship === "first-party") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
    };
  }

  if (input.relationship === "unknown") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
    };
  }

  if (input.catalogDefaultAction === "block") {
    return {
      status: "blocked",
      source: "automatic",
      shouldBlock: true,
    };
  }

  if (input.catalogDefaultAction === "allow") {
    return {
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
    };
  }

  return {
    status: "allowed",
    source: "automatic",
    shouldBlock: false,
  };
}
