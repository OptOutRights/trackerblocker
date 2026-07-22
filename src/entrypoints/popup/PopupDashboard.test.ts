import { describe, expect, it } from "vitest";

import type { GetTabRequestSummaryResponse } from "../../messaging/requestSummary";
import { formatProtectionSummary } from "./PopupDashboard";

function createSummary(
  enforcement: GetTabRequestSummaryResponse["enforcement"],
): GetTabRequestSummaryResponse {
  return {
    type: "trackerblocker.getTabRequestSummaryResponse",
    tabId: 12,
    generation: 1,
    siteUrl: "https://publisher.test/",
    siteHost: "publisher.test",
    requestCounts: { total: 0, blocked: 0, restricted: 0, allowed: 0 },
    hostCounts: {
      observed: 0,
      thirdParty: 0,
      unknown: 0,
      firstParty: 0,
      blocked: 0,
      restricted: 0,
      allowed: 0,
      mixed: 0,
      lowerBound: false,
    },
    hostRowsTruncated: false,
    activeRequestEvidenceTruncated: false,
    omittedRequestCount: 0,
    rows: [],
    sitePauseStatus: "active",
    settingsHealth: "ready",
    enforcement,
  };
}

describe("formatProtectionSummary", () => {
  it("shows a known authoritative count", () => {
    expect(
      formatProtectionSummary(
        createSummary({ status: "active", blockedCount: 3 }),
      ),
    ).toEqual({ value: "3", label: "Requests blocked" });
  });

  it("never renders unknown protection as zero", () => {
    expect(formatProtectionSummary(null)).toEqual({
      value: "—",
      label: "Checking blocked count",
    });
    expect(
      formatProtectionSummary(
        createSummary({ status: "unavailable", blockedCount: null }),
      ),
    ).toEqual({ value: "—", label: "Blocked count unavailable" });
  });

  it("labels paused protection explicitly", () => {
    expect(
      formatProtectionSummary(
        createSummary({ status: "paused", blockedCount: null }),
      ),
    ).toEqual({ value: "—", label: "Protection paused" });
  });
});
