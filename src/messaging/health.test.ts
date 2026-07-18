import { describe, expect, it } from "vitest";

import {
  HEALTH_CHECK_MESSAGE,
  type HealthCheckResponse,
  isHealthCheckMessage,
} from "./health";

describe("isHealthCheckMessage", () => {
  it("accepts the health-check message shape", () => {
    expect(isHealthCheckMessage({ type: HEALTH_CHECK_MESSAGE })).toBe(true);
  });

  it("rejects unrelated messages", () => {
    expect(isHealthCheckMessage({ type: "trackerblocker.other" })).toBe(false);
    expect(isHealthCheckMessage(null)).toBe(false);
  });

  it("keeps engine health limited to the inspectable Phase 2 states", () => {
    const response: HealthCheckResponse = {
      type: "trackerblocker.healthCheckResponse",
      ok: true,
      startedAt: "2026-07-17T00:00:00.000Z",
      easyPrivacy: {
        matchingEnabled: false,
        engineHealth: "degraded",
      },
    };

    expect(response.easyPrivacy).toEqual({
      matchingEnabled: false,
      engineHealth: "degraded",
    });
  });
});
