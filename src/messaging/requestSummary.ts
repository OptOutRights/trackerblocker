import type {
  HostRequestDetails,
  TabRequestSummary,
} from "../shared/requestObservation";
import type { SitePauseStatus } from "../storage/settings";
import type { SettingsRuntimeHealth } from "../storage/settingsRuntime";

export type RuntimeSitePauseStatus = SitePauseStatus | "unknown";

export const GET_TAB_REQUEST_SUMMARY_MESSAGE =
  "trackerblocker.getTabRequestSummary";
export const GET_TAB_REQUEST_SUMMARY_RESPONSE =
  "trackerblocker.getTabRequestSummaryResponse";
export const GET_HOST_REQUEST_DETAILS_MESSAGE =
  "trackerblocker.getHostRequestDetails";
export const GET_HOST_REQUEST_DETAILS_RESPONSE =
  "trackerblocker.getHostRequestDetailsResponse";

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

export interface GetHostRequestDetailsMessage {
  type: typeof GET_HOST_REQUEST_DETAILS_MESSAGE;
  tabId: number;
  generation: number;
  rowId: string;
}

export interface GetHostRequestDetailsResponse {
  type: typeof GET_HOST_REQUEST_DETAILS_RESPONSE;
  details: HostRequestDetails | null;
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

export function isGetHostRequestDetailsMessage(
  value: unknown,
): value is GetHostRequestDetailsMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === GET_HOST_REQUEST_DETAILS_MESSAGE &&
    "tabId" in value &&
    typeof value.tabId === "number" &&
    "generation" in value &&
    Number.isSafeInteger(value.generation) &&
    "rowId" in value &&
    typeof value.rowId === "string"
  );
}

export function isGetHostRequestDetailsResponse(
  value: unknown,
): value is GetHostRequestDetailsResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === GET_HOST_REQUEST_DETAILS_RESPONSE &&
    "details" in value &&
    (value.details === null ||
      (typeof value.details === "object" &&
        value.details !== null &&
        "tabId" in value.details &&
        typeof value.details.tabId === "number" &&
        "generation" in value.details &&
        Number.isSafeInteger(value.details.generation) &&
        "rowId" in value.details &&
        typeof value.details.rowId === "string" &&
        "samples" in value.details &&
        Array.isArray(value.details.samples) &&
        "truncated" in value.details &&
        typeof value.details.truncated === "boolean"))
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
    "generation" in value &&
    Number.isSafeInteger(value.generation) &&
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
