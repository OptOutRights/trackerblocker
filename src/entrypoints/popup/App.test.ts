import { describe, expect, it } from "vitest";

import type { HostRequestDetails } from "../../shared/requestObservation";
import {
  IDLE_HOST_DETAILS_STATE,
  hostDetailsReducer,
  type HostDetailsRequestIdentity,
} from "./App";

function createDetails(
  request: HostDetailsRequestIdentity,
): HostRequestDetails {
  return {
    ...request,
    host: `${request.rowId}.test`,
    displayName: `${request.rowId}.test`,
    samples: [],
    truncated: false,
  };
}

describe("host details state", () => {
  it("ignores an older response after another row starts loading", () => {
    const requestA = { tabId: 12, generation: 3, rowId: "row-a" };
    const requestB = { tabId: 12, generation: 3, rowId: "row-b" };
    let state = hostDetailsReducer(IDLE_HOST_DETAILS_STATE, {
      type: "start",
      request: requestA,
    });
    state = hostDetailsReducer(state, {
      type: "start",
      request: requestB,
    });
    state = hostDetailsReducer(state, {
      type: "resolve",
      request: requestB,
      details: createDetails(requestB),
    });

    expect(
      hostDetailsReducer(state, {
        type: "resolve",
        request: requestA,
        details: createDetails(requestA),
      }),
    ).toEqual(state);
  });

  it("clears details when the tab observation generation changes", () => {
    const request = { tabId: 12, generation: 3, rowId: "row-a" };
    const ready = hostDetailsReducer(
      hostDetailsReducer(IDLE_HOST_DETAILS_STATE, {
        type: "start",
        request,
      }),
      { type: "resolve", request, details: createDetails(request) },
    );

    expect(
      hostDetailsReducer(ready, {
        type: "clear-unless-summary",
        tabId: 12,
        generation: 4,
      }),
    ).toEqual(IDLE_HOST_DETAILS_STATE);
  });

  it("rejects details whose response identity does not match the request", () => {
    const request = { tabId: 12, generation: 3, rowId: "row-a" };
    const loading = hostDetailsReducer(IDLE_HOST_DETAILS_STATE, {
      type: "start",
      request,
    });

    expect(
      hostDetailsReducer(loading, {
        type: "resolve",
        request,
        details: createDetails({ ...request, generation: 2 }),
      }),
    ).toEqual({
      request,
      status: "unavailable",
      details: null,
    });
  });
});
