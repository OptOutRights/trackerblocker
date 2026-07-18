import { describe, expect, it } from "vitest";

import {
  applyRequestHeaderRestriction,
  stripTrackingRequestHeaders,
} from "./requestRestriction";

describe("request restriction", () => {
  it("removes only cookies and referrers from restricted requests", () => {
    const headers = stripTrackingRequestHeaders([
      { name: "Cookie", value: "session=secret" },
      { name: "REFERER", value: "https://example.com/private" },
      { name: "Accept", value: "application/json" },
    ]);

    expect(headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
  });

  it("leaves headers unchanged without a cached restriction", () => {
    const headers = [{ name: "Cookie", value: "session=secret" }];
    expect(applyRequestHeaderRestriction(headers, null)).toBe(headers);
  });
});
