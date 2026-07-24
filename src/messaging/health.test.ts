import { describe, expect, it } from "vitest";

import {
  HEALTH_CHECK_MESSAGE,
  HEALTH_CHECK_RESPONSE,
  type HealthCheckResponse,
  isHealthCheckMessage,
  isHealthCheckResponse,
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
        degradedReason: "artifact-invalid",
        provenance: null,
        hostPermissionGranted: false,
      },
      settings: {
        health: "degraded",
        hasUsableSnapshot: false,
        degradedReason: "timeout",
      },
    };

    expect(response.easyPrivacy).toEqual({
      matchingEnabled: false,
      engineHealth: "degraded",
      degradedReason: "artifact-invalid",
      provenance: null,
      hostPermissionGranted: false,
    });
  });
});

describe("isHealthCheckResponse", () => {
  const response: HealthCheckResponse = {
    type: HEALTH_CHECK_RESPONSE,
    ok: true,
    startedAt: "2026-07-17T00:00:00.000Z",
    easyPrivacy: {
      matchingEnabled: true,
      engineHealth: "ready",
      degradedReason: null,
      provenance: null,
      hostPermissionGranted: true,
    },
    settings: {
      health: "ready",
      hasUsableSnapshot: true,
      degradedReason: null,
    },
  };

  it("accepts a complete health response", () => {
    expect(isHealthCheckResponse(response)).toBe(true);
  });

  it("rejects incomplete health responses", () => {
    expect(
      isHealthCheckResponse({
        ...response,
        easyPrivacy: { engineHealth: "ready" },
      }),
    ).toBe(false);
    expect(isHealthCheckResponse(null)).toBe(false);
  });
});
