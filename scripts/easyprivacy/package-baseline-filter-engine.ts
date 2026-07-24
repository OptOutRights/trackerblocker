// Build-only counterfactual used to measure the complete compressed
// EasyPrivacy adapter/dependency/data delta against the same application commit.
// Production builds never set TRACKERBLOCKER_QA_PACKAGE_BASELINE.

export interface FilterRuleEvidence {
  key: string;
  engineId: string;
  normalizedSummary: string;
  requestTypes: string[];
  partyScope: "first-party" | "third-party" | "any";
  sourceConstraint: "none" | "compacted";
}

export type FilterMatchResult = {
  outcome: "unavailable";
  health: "loading";
  matchedFilter: null;
  matchedException: null;
};

export class FilterEngine {
  readonly health = "loading" as const;
  readonly degradedReason = null;
  readonly provenance = null;

  async initialize(): Promise<void> {}

  match(): FilterMatchResult {
    return {
      outcome: "unavailable",
      health: "loading",
      matchedFilter: null,
      matchedException: null,
    };
  }
}
