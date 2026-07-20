import type {
  FilterEngineDegradedReason,
  FilterEngineHealth,
  FilterEngineProvenance,
} from "../shared/filterEngine";
import type {
  SettingsRuntimeHealth,
  SettingsRuntimeSnapshot,
} from "../storage/settingsRuntime";

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
    degradedReason: FilterEngineDegradedReason | null;
    provenance: FilterEngineProvenance | null;
    hostPermissionGranted: boolean;
  };
  settings: {
    health: SettingsRuntimeHealth;
    hasUsableSnapshot: boolean;
    degradedReason: SettingsRuntimeSnapshot["degradedReason"];
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
