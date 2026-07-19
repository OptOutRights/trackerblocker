import { describe, expect, it } from "vitest";

import {
  GET_TAB_REQUEST_SUMMARY_MESSAGE,
  GET_TAB_REQUEST_SUMMARY_RESPONSE,
  isGetTabRequestSummaryMessage,
  isGetTabRequestSummaryResponse,
} from "./requestSummary";

describe("request summary messaging", () => {
  it("accepts the request summary message shape", () => {
    expect(
      isGetTabRequestSummaryMessage({
        type: GET_TAB_REQUEST_SUMMARY_MESSAGE,
        tabId: 1,
      }),
    ).toBe(true);
  });

  it("rejects invalid request summary messages", () => {
    expect(
      isGetTabRequestSummaryMessage({
        type: GET_TAB_REQUEST_SUMMARY_MESSAGE,
        tabId: "1",
      }),
    ).toBe(false);
    expect(isGetTabRequestSummaryMessage(null)).toBe(false);
  });

  it("accepts the request summary response shape", () => {
    expect(
      isGetTabRequestSummaryResponse({
        type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
        tabId: 1,
        sitePauseStatus: "active",
        settingsHealth: "ready",
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
        omittedRequestCount: 0,
        activeRequestEvidenceTruncated: false,
        rows: [],
      }),
    ).toBe(true);
  });

  it("rejects invalid request summary responses", () => {
    expect(
      isGetTabRequestSummaryResponse({
        type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
        tabId: 1,
        sitePauseStatus: "paused-forever",
        settingsHealth: "ready",
        requestCounts: {},
        hostCounts: {},
        hostRowsTruncated: false,
        omittedRequestCount: 0,
        activeRequestEvidenceTruncated: false,
        rows: {},
      }),
    ).toBe(false);
  });
});
