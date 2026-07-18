export const HEALTH_CHECK_MESSAGE = "trackerblocker.healthCheck";
export const HEALTH_CHECK_RESPONSE = "trackerblocker.healthCheckResponse";

export interface HealthCheckMessage {
  type: typeof HEALTH_CHECK_MESSAGE;
}

export interface HealthCheckResponse {
  type: typeof HEALTH_CHECK_RESPONSE;
  ok: boolean;
  startedAt: string;
  easyPrivacy: {
    matchingEnabled: boolean;
    engineHealth: FilterEngineHealth;
  };
}

export function isHealthCheckMessage(value: unknown): value is HealthCheckMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === HEALTH_CHECK_MESSAGE
  );
}
import type { FilterEngineHealth } from "../shared/filterEngine";
