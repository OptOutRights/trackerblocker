import { describe, expect, it } from "vitest";

import type { ObservedRequestRow } from "../../shared/requestObservation";
import { formatCatalogBasis } from "./RequestRows";

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
      "packaged block rule, rules: collect-endpoint, medium breakage risk",
    );
  });
});
