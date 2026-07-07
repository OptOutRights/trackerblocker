import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_RESPONSE,
  isHealthCheckMessage,
  type HealthCheckResponse,
} from "../messaging/health";
import {
  GET_TAB_REQUEST_SUMMARY_RESPONSE,
  isGetTabRequestSummaryMessage,
  type GetTabRequestSummaryResponse,
} from "../messaging/requestSummary";
import {
  SETTINGS_ERROR_RESPONSE,
  SETTINGS_RESPONSE,
  isGetSettingsMessage,
  isResetSettingsMessage,
  isSetDomainOverrideMessage,
  isUpdateSitePauseMessage,
  type SettingsErrorResponse,
  type SettingsResponse,
} from "../messaging/settings";
import {
  createTabObservationState,
  recordObservedRequest,
  resetTabObservationState,
  summarizeTabObservation,
  type TabObservationState,
} from "../shared/requestObservation";
import { readSettings, resetSettings, updateSettings } from "../storage/settings";

export default defineBackground(() => {
  const startedAt = new Date().toISOString();
  const tabObservations = new Map<number, TabObservationState>();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (isHealthCheckMessage(message)) {
      const response: HealthCheckResponse = {
        type: HEALTH_CHECK_RESPONSE,
        ok: true,
        startedAt,
      };

      sendResponse(response);
      return false;
    }

    if (isGetTabRequestSummaryMessage(message)) {
      const state = getTabObservationState(
        tabObservations,
        message.tabId,
        message.pageUrl,
      );
      const summary = summarizeTabObservation(state);
      const response: GetTabRequestSummaryResponse = {
        type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
        ...summary,
      };

      sendResponse(response);
      return false;
    }

    if (isGetSettingsMessage(message)) {
      void sendSettingsResponse(() => readSettings(), sendResponse);
      return true;
    }

    if (isUpdateSitePauseMessage(message)) {
      void sendSettingsResponse(
        () =>
          updateSettings({
            type: "site-pause",
            site: message.site,
            paused: message.paused,
          }),
        sendResponse,
      );
      return true;
    }

    if (isSetDomainOverrideMessage(message)) {
      void sendSettingsResponse(
        () =>
          updateSettings({
            type: "domain-override",
            domain: message.domain,
            action: message.action,
          }),
        sendResponse,
      );
      return true;
    }

    if (isResetSettingsMessage(message)) {
      void sendSettingsResponse(() => resetSettings(), sendResponse);
      return true;
    }

    return false;
  });

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId < 0) {
        return undefined;
      }

      const requestDocumentUrl = getRequestDocumentUrl(details);
      const state = getTabObservationState(
        tabObservations,
        details.tabId,
        requestDocumentUrl,
      );

      if (details.type === "main_frame") {
        resetTabObservationState(state, details.url);
        return undefined;
      }

      recordObservedRequest(state, {
        tabId: details.tabId,
        frameId: details.frameId,
        pageUrl: state.pageUrl ?? requestDocumentUrl,
        requestUrl: details.url,
        requestType: details.type,
        timestamp: details.timeStamp,
      });

      return undefined;
    },
    { urls: ["<all_urls>"] },
  );

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) {
      return;
    }

    const state = getTabObservationState(tabObservations, tabId);

    if (state.pageUrl === changeInfo.url) {
      return;
    }

    resetTabObservationState(state, changeInfo.url);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabObservations.delete(tabId);
  });

  console.info(`[TrackerBlocker] Background ready at ${startedAt}`);
});

async function sendSettingsResponse(
  loadSettings: () => Promise<Omit<SettingsResponse, "type">>,
  sendResponse: (response: SettingsResponse | SettingsErrorResponse) => void,
): Promise<void> {
  try {
    const settings = await loadSettings();

    sendResponse({
      type: SETTINGS_RESPONSE,
      ...settings,
    });
  } catch {
    sendResponse({
      type: SETTINGS_ERROR_RESPONSE,
      reason: "storage-unavailable",
    });
  }
}

function getTabObservationState(
  tabObservations: Map<number, TabObservationState>,
  tabId: number,
  pageUrl?: string | null,
): TabObservationState {
  const existing = tabObservations.get(tabId);

  if (existing) {
    if (!existing.pageUrl && pageUrl) {
      existing.pageUrl = pageUrl;
    }

    return existing;
  }

  const state = createTabObservationState(tabId, pageUrl);
  tabObservations.set(tabId, state);
  return state;
}

function getRequestDocumentUrl(details: unknown): string | undefined {
  if (
    typeof details === "object" &&
    details !== null &&
    "documentUrl" in details &&
    typeof details.documentUrl === "string"
  ) {
    return details.documentUrl;
  }

  if (
    typeof details === "object" &&
    details !== null &&
    "originUrl" in details &&
    typeof details.originUrl === "string"
  ) {
    return details.originUrl;
  }

  return undefined;
}
