import type { TabRequestSummary } from "../shared/requestObservation";
import type { SitePauseStatus } from "../storage/settings";
import type { SettingsRuntimeHealth } from "../storage/settingsRuntime";

export type RuntimeSitePauseStatus = SitePauseStatus | "unknown";

export const GET_TAB_REQUEST_SUMMARY_MESSAGE =
  "trackerblocker.getTabRequestSummary";
export const GET_TAB_REQUEST_SUMMARY_RESPONSE =
  "trackerblocker.getTabRequestSummaryResponse";

export interface GetTabRequestSummaryMessage {
  type: typeof GET_TAB_REQUEST_SUMMARY_MESSAGE;
  tabId: number;
  pageUrl?: string | null;
}

export interface GetTabRequestSummaryResponse extends TabRequestSummary {
  type: typeof GET_TAB_REQUEST_SUMMARY_RESPONSE;
  sitePauseStatus: RuntimeSitePauseStatus;
  settingsHealth: SettingsRuntimeHealth;
}

export function isGetTabRequestSummaryMessage(
  value: unknown,
): value is GetTabRequestSummaryMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === GET_TAB_REQUEST_SUMMARY_MESSAGE &&
    "tabId" in value &&
    typeof value.tabId === "number"
  );
}

export function isGetTabRequestSummaryResponse(
  value: unknown,
): value is GetTabRequestSummaryResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === GET_TAB_REQUEST_SUMMARY_RESPONSE &&
    "tabId" in value &&
    typeof value.tabId === "number" &&
    "rows" in value &&
    Array.isArray(value.rows) &&
    "requestCounts" in value &&
    hasNonNegativeCounts(value.requestCounts, [
      "total",
      "blocked",
      "restricted",
      "allowed",
    ]) &&
    "hostCounts" in value &&
    hasNonNegativeCounts(value.hostCounts, [
      "observed",
      "thirdParty",
      "unknown",
      "firstParty",
      "blocked",
      "restricted",
      "allowed",
      "mixed",
    ]) &&
    typeof value.hostCounts === "object" &&
    value.hostCounts !== null &&
    "lowerBound" in value.hostCounts &&
    typeof value.hostCounts.lowerBound === "boolean" &&
    "hostRowsTruncated" in value &&
    typeof value.hostRowsTruncated === "boolean" &&
    "activeRequestEvidenceTruncated" in value &&
    typeof value.activeRequestEvidenceTruncated === "boolean" &&
    "omittedRequestCount" in value &&
    Number.isSafeInteger(value.omittedRequestCount) &&
    (value.omittedRequestCount as number) >= 0 &&
    "sitePauseStatus" in value &&
    (value.sitePauseStatus === "active" ||
      value.sitePauseStatus === "paused-once" ||
      value.sitePauseStatus === "paused-always" ||
      value.sitePauseStatus === "unknown") &&
    "settingsHealth" in value &&
    (value.settingsHealth === "loading" ||
      value.settingsHealth === "ready" ||
      value.settingsHealth === "degraded")
  );
}

function hasNonNegativeCounts(
  value: unknown,
  keys: readonly string[],
): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    keys.every(
      (key) =>
        key in value &&
        Number.isSafeInteger((value as Record<string, unknown>)[key]) &&
        ((value as Record<string, number>)[key] ?? -1) >= 0,
    )
  );
}
