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

export function isHealthCheckResponse(
  value: unknown,
): value is HealthCheckResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === HEALTH_CHECK_RESPONSE &&
    "ok" in value &&
    value.ok === true &&
    "startedAt" in value &&
    typeof value.startedAt === "string" &&
    "easyPrivacy" in value &&
    typeof value.easyPrivacy === "object" &&
    value.easyPrivacy !== null &&
    "matchingEnabled" in value.easyPrivacy &&
    typeof value.easyPrivacy.matchingEnabled === "boolean" &&
    "engineHealth" in value.easyPrivacy &&
    (value.easyPrivacy.engineHealth === "loading" ||
      value.easyPrivacy.engineHealth === "ready" ||
      value.easyPrivacy.engineHealth === "degraded") &&
    "hostPermissionGranted" in value.easyPrivacy &&
    typeof value.easyPrivacy.hostPermissionGranted === "boolean" &&
    "degradedReason" in value.easyPrivacy &&
    (value.easyPrivacy.degradedReason === null ||
      value.easyPrivacy.degradedReason === "artifact-load-failed" ||
      value.easyPrivacy.degradedReason === "artifact-invalid" ||
      value.easyPrivacy.degradedReason === "engine-invalid") &&
    "provenance" in value.easyPrivacy &&
    (value.easyPrivacy.provenance === null ||
      isFilterEngineProvenance(value.easyPrivacy.provenance)) &&
    "settings" in value &&
    typeof value.settings === "object" &&
    value.settings !== null &&
    "health" in value.settings &&
    (value.settings.health === "loading" ||
      value.settings.health === "ready" ||
      value.settings.health === "degraded") &&
    "hasUsableSnapshot" in value.settings &&
    typeof value.settings.hasUsableSnapshot === "boolean" &&
    "degradedReason" in value.settings &&
    (value.settings.degradedReason === null ||
      value.settings.degradedReason === "timeout" ||
      value.settings.degradedReason === "storage-unavailable")
  );
}

function isFilterEngineProvenance(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "upstreamVersion" in value &&
    typeof value.upstreamVersion === "string" &&
    "artifactSha256" in value &&
    typeof value.artifactSha256 === "string" &&
    "ghosteryPackageVersion" in value &&
    typeof value.ghosteryPackageVersion === "string"
  );
}
