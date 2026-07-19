import { describe, expect, it } from "vitest";

import type { ObservedRequestRow } from "../../shared/requestObservation";
import {
  formatActionSummary,
  formatCatalogBasis,
  formatRuleSources,
} from "./RequestRows";

describe("formatCatalogBasis", () => {
  it("describes packaged policy without inventing provenance", () => {
    const row = {
      relationship: "third-party",
      catalogDefaultAction: "block",
      catalogRuleIds: ["collect-endpoint"],
      catalogConfidence: null,
      catalogBreakageRisk: "medium",
      catalogSource: null,
    } as ObservedRequestRow;

    expect(formatCatalogBasis(row)).toBe(
      "observed catalog evidence includes a packaged block rule, rules: collect-endpoint, medium breakage risk",
    );
  });
});

describe("mixed request presentation", () => {
  it("labels actions and sources as request counts instead of one host status", () => {
    const row = {
      actionCounts: { total: 9, blocked: 3, restricted: 1, allowed: 5 },
      sourceCounts: {
        "site-pause": 0,
        "user-block": 0,
        "user-allow": 1,
        "settings-unavailable": 1,
        easyprivacy: 3,
        catalog: 1,
        default: 3,
      },
    } as ObservedRequestRow;

    expect(formatActionSummary(row)).toBe(
      "3 blocked, 1 restricted, 5 allowed",
    );
    expect(formatRuleSources(row)).toBe(
      "user allow: 1, settings unavailable: 1, EasyPrivacy: 3, catalog: 1, default allow: 3",
    );
  });
});
