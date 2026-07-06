import { describe, expect, it } from "vitest";

import { HEALTH_CHECK_MESSAGE, isHealthCheckMessage } from "./health";

describe("isHealthCheckMessage", () => {
  it("accepts the health-check message shape", () => {
    expect(isHealthCheckMessage({ type: HEALTH_CHECK_MESSAGE })).toBe(true);
  });

  it("rejects unrelated messages", () => {
    expect(isHealthCheckMessage({ type: "trackerblocker.other" })).toBe(false);
    expect(isHealthCheckMessage(null)).toBe(false);
  });
});
