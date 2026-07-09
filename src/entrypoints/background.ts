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
import { formatUrlHost } from "../shared/domains";
import {
  normalizeSettings,
  normalizeSettingsKey,
  readSettings,
  resetSettings,
  updateSettings,
  type SitePauseStatus,
  type TrackerBlockerSettings,
} from "../storage/settings";

export default defineBackground(() => {
  const startedAt = new Date().toISOString();
  const tabObservations = new Map<number, TabObservationState>();
  const temporarySitePauses = new Map<number, string>();
  let settingsCache = normalizeSettings(undefined);

  const registerListeners = () => {
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
        const sitePauseStatus = getSitePauseStatus(
          temporarySitePauses,
          message.tabId,
          state.pageUrl ?? message.pageUrl,
          settingsCache,
        );
        const summary = summarizeTabObservation(state, {
          sitePaused: sitePauseStatus !== "active",
          domainOverrides: settingsCache.domainOverrides,
        });
        const response: GetTabRequestSummaryResponse = {
          type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
          sitePauseStatus,
          ...summary,
        };

        sendResponse(response);
        return false;
      }

      if (isGetSettingsMessage(message)) {
        void sendSettingsResponse(
          () => readSettings(),
          sendResponse,
          (settings) => {
            settingsCache = settings;
          },
        );
        return true;
      }

      if (isUpdateSitePauseMessage(message)) {
        if (message.mode === "once") {
          void sendSettingsResponse(
            () => readSettings(),
            sendResponse,
            (settings) => {
              settingsCache = settings;
              if (typeof message.tabId === "number") {
                setTemporarySitePause(
                  temporarySitePauses,
                  message.tabId,
                  message.site,
                );
              }
            },
          );
          return true;
        }

        void sendSettingsResponse(
          () =>
            updateSettings({
              type: "site-pause",
              site: message.site,
              paused: message.mode === "always",
            }),
          sendResponse,
          (settings) => {
            settingsCache = settings;
            if (
              (message.mode === null || message.mode === "always") &&
              typeof message.tabId === "number"
            ) {
              temporarySitePauses.delete(message.tabId);
            }
          },
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
          (settings) => {
            settingsCache = settings;
          },
        );
        return true;
      }

      if (isResetSettingsMessage(message)) {
        void sendSettingsResponse(
          () => resetSettings(),
          sendResponse,
          (settings) => {
            settingsCache = settings;
            temporarySitePauses.clear();
          },
        );
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
          clearTemporaryPauseForNavigation(
            temporarySitePauses,
            details.tabId,
            details.url,
          );
          resetTabObservationState(state, details.url);
          return undefined;
        }

        const sitePauseStatus = getSitePauseStatus(
          temporarySitePauses,
          details.tabId,
          state.pageUrl ?? requestDocumentUrl,
          settingsCache,
        );

        const row = recordObservedRequest(state, {
          tabId: details.tabId,
          frameId: details.frameId,
          pageUrl: state.pageUrl ?? requestDocumentUrl,
          requestUrl: details.url,
          requestType: details.type,
          timestamp: details.timeStamp,
          sitePaused: sitePauseStatus !== "active",
          domainOverrides: settingsCache.domainOverrides,
        });

        return row.status === "blocked" ? { cancel: true } : undefined;
      },
      { urls: ["<all_urls>"] },
      ["blocking"],
    );

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!changeInfo.url) {
        return;
      }

      const state = getTabObservationState(tabObservations, tabId);
      clearTemporaryPauseForNavigation(temporarySitePauses, tabId, changeInfo.url);

      if (state.pageUrl === changeInfo.url) {
        return;
      }

      resetTabObservationState(state, changeInfo.url);
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      tabObservations.delete(tabId);
      temporarySitePauses.delete(tabId);
    });

    console.info(`[TrackerBlocker] Background ready at ${startedAt}`);
  };

  void readSettings()
    .catch(() => normalizeSettings(undefined))
    .then((settings) => {
      settingsCache = settings;
      registerListeners();
    });
});

async function sendSettingsResponse(
  loadSettings: () => Promise<Omit<SettingsResponse, "type">>,
  sendResponse: (response: SettingsResponse | SettingsErrorResponse) => void,
  onSettingsLoaded?: (settings: TrackerBlockerSettings) => void,
): Promise<void> {
  try {
    const settings = await loadSettings();
    onSettingsLoaded?.(settings);

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

function getSitePauseStatus(
  temporarySitePauses: Map<number, string>,
  tabId: number,
  pageUrl: string | null | undefined,
  settings: TrackerBlockerSettings,
): SitePauseStatus {
  const site = normalizeSiteFromUrl(pageUrl);

  if (!site) {
    return "active";
  }

  if (settings.pausedSites[site] === true) {
    return "paused-always";
  }

  return temporarySitePauses.get(tabId) === site ? "paused-once" : "active";
}

function setTemporarySitePause(
  temporarySitePauses: Map<number, string>,
  tabId: number,
  site: string,
): void {
  const normalizedSite = normalizeSettingsKey(site);

  if (normalizedSite) {
    temporarySitePauses.set(tabId, normalizedSite);
  }
}

function clearTemporaryPauseForNavigation(
  temporarySitePauses: Map<number, string>,
  tabId: number,
  nextUrl: string,
): void {
  const pausedSite = temporarySitePauses.get(tabId);

  if (!pausedSite) {
    return;
  }

  if (normalizeSiteFromUrl(nextUrl) !== pausedSite) {
    temporarySitePauses.delete(tabId);
  }
}

function normalizeSiteFromUrl(url: string | null | undefined): string | null {
  const site = formatUrlHost(url);

  return site ? normalizeSettingsKey(site) : null;
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
