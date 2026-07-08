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
        rows: {},
      }),
    ).toBe(false);
  });
});
