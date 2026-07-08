import type { TabRequestSummary } from "../shared/requestObservation";
import type { SitePauseStatus } from "../storage/settings";

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
  sitePauseStatus: SitePauseStatus;
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
    "sitePauseStatus" in value &&
    (value.sitePauseStatus === "active" ||
      value.sitePauseStatus === "paused-once" ||
      value.sitePauseStatus === "paused-always")
  );
}
