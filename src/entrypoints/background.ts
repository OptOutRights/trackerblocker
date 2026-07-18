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
import { ActionBadgeUpdateQueue } from "../shared/actionBadge";
import { EASYPRIVACY_MATCHING_ENABLED } from "../shared/buildFlags";
import { formatUrlHost } from "../shared/domains";
import { FilterEngine } from "../shared/filterEngine";
import {
  createTabObservationState,
  recordObservedRequest,
  recordRequestCompleted,
  recordRequestFailed,
  recordRequestRedirect,
  resetTabObservationState,
  summarizeTabObservation,
  type TabObservationState,
} from "../shared/requestObservation";
import { applyRequestHeaderRestriction } from "../shared/requestRestriction";
import {
  RequestDecisionCache,
  createNavigationAllowDecision,
  decideRequest,
  normalizeRequestContext,
  type RequestDecision,
} from "../shared/requestDecisions";
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
  const actionBadgeUpdates = new ActionBadgeUpdateQueue();
  const filterEngine = new FilterEngine();
  const requestDecisions = new RequestDecisionCache();
  const temporarySitePauses = new Map<number, string>();
  let settingsCache = normalizeSettings(undefined);

  void filterEngine.initialize(loadPackagedEasyPrivacyArtifact);

  const registerListeners = () => {
    void initializeActionBadge();

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isHealthCheckMessage(message)) {
        const response: HealthCheckResponse = {
          type: HEALTH_CHECK_RESPONSE,
          ok: true,
          startedAt,
          easyPrivacy: {
            matchingEnabled: EASYPRIVACY_MATCHING_ENABLED,
            engineHealth: filterEngine.health,
          },
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
            void updateObservedActionBadges(
              tabObservations,
              temporarySitePauses,
              settingsCache,
              actionBadgeUpdates,
            );
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
              void updateObservedActionBadges(
                tabObservations,
                temporarySitePauses,
                settingsCache,
                actionBadgeUpdates,
              );
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
            void updateObservedActionBadges(
              tabObservations,
              temporarySitePauses,
              settingsCache,
              actionBadgeUpdates,
            );
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
            void updateObservedActionBadges(
              tabObservations,
              temporarySitePauses,
              settingsCache,
              actionBadgeUpdates,
            );
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
            void updateObservedActionBadges(
              tabObservations,
              temporarySitePauses,
              settingsCache,
              actionBadgeUpdates,
            );
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
          // Requests from the previous document can outlive navigation. Keep
          // their decisions until completion/failure so later listeners reuse
          // the policy result produced for the original request context.
          clearTemporaryPauseForNavigation(
            temporarySitePauses,
            details.tabId,
            details.url,
          );
          resetTabObservationState(state, details.url);
          requestDecisions.set(
            createNavigationAllowDecision(
              normalizeRequestContext({
                requestId: details.requestId,
                tabId: details.tabId,
                pageUrl: details.url,
                requestUrl: details.url,
                requestType: details.type,
              }),
            ),
          );
          void updateActionBadgeForTab(
            state,
            temporarySitePauses,
            settingsCache,
            actionBadgeUpdates,
          );
          return undefined;
        }

        const sitePauseStatus = getSitePauseStatus(
          temporarySitePauses,
          details.tabId,
          state.pageUrl ?? requestDocumentUrl,
          settingsCache,
        );

        const decision = decideWebRequest(
          details,
          state.pageUrl ?? requestDocumentUrl,
          sitePauseStatus !== "active",
          settingsCache,
          filterEngine,
        );
        requestDecisions.set(decision);

        recordObservedRequest(
          state,
          {
            requestId: details.requestId,
            tabId: details.tabId,
            frameId: details.frameId,
            parentFrameId: getRequestParentFrameId(details),
            pageUrl: state.pageUrl ?? requestDocumentUrl,
            documentUrl: getRequestDocumentUrl(details),
            originUrl: getRequestOriginUrl(details),
            initiator: getRequestInitiator(details),
            requestUrl: details.url,
            requestType: details.type,
            timestamp: details.timeStamp,
            sitePaused: sitePauseStatus !== "active",
            domainOverrides: settingsCache.domainOverrides,
          },
          { decision },
        );
        void updateActionBadgeForTab(
          state,
          temporarySitePauses,
          settingsCache,
          actionBadgeUpdates,
        );

        return decision.action === "block" ? { cancel: true } : undefined;
      },
      { urls: ["<all_urls>"] },
      ["blocking"],
    );

    browser.webRequest.onBeforeRedirect.addListener(
      (details) => {
        if (details.tabId < 0) {
          return;
        }

        const state = tabObservations.get(details.tabId);

        if (!state) {
          return;
        }

        recordRequestRedirect(state, {
          requestId: details.requestId,
          fromUrl: details.url,
          redirectUrl: details.redirectUrl,
          statusCode: details.statusCode,
          timestamp: details.timeStamp,
        });
        void updateActionBadgeForTab(
          state,
          temporarySitePauses,
          settingsCache,
          actionBadgeUpdates,
        );
      },
      { urls: ["<all_urls>"] },
    );

    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        if (details.tabId < 0) {
          return undefined;
        }

        const state = tabObservations.get(details.tabId);
        const requestDocumentUrl = getRequestDocumentUrl(details);
        const pageUrl = state?.pageUrl ?? requestDocumentUrl;
        const sitePauseStatus = getSitePauseStatus(
          temporarySitePauses,
          details.tabId,
          pageUrl,
          settingsCache,
        );
        const decision = requestDecisions.resolve(
          details.requestId,
          details.tabId,
          () =>
            decideWebRequest(
              details,
              pageUrl,
              sitePauseStatus !== "active",
              settingsCache,
              filterEngine,
            ),
        );

        if (!decision.headerRestriction || !details.requestHeaders) {
          return undefined;
        }

        const requestHeaders = applyRequestHeaderRestriction(
          details.requestHeaders,
          decision.headerRestriction,
        );

        return { requestHeaders };
      },
      { urls: ["<all_urls>"] },
      ["blocking", "requestHeaders"],
    );

    browser.webRequest.onCompleted.addListener(
      (details) => {
        if (details.tabId < 0) {
          return;
        }

        requestDecisions.delete(details.requestId);

        const state = tabObservations.get(details.tabId);

        if (!state) {
          return;
        }

        recordRequestCompleted(state, {
          requestId: details.requestId,
          timestamp: details.timeStamp,
        });
        void updateActionBadgeForTab(
          state,
          temporarySitePauses,
          settingsCache,
          actionBadgeUpdates,
        );
      },
      { urls: ["<all_urls>"] },
    );

    browser.webRequest.onErrorOccurred.addListener(
      (details) => {
        if (details.tabId < 0) {
          return;
        }

        requestDecisions.delete(details.requestId);

        const state = tabObservations.get(details.tabId);

        if (!state) {
          return;
        }

        recordRequestFailed(state, {
          requestId: details.requestId,
          timestamp: details.timeStamp,
        });
        void updateActionBadgeForTab(
          state,
          temporarySitePauses,
          settingsCache,
          actionBadgeUpdates,
        );
      },
      { urls: ["<all_urls>"] },
    );

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!changeInfo.url) {
        return;
      }

      const state = getTabObservationState(tabObservations, tabId);
      clearTemporaryPauseForNavigation(
        temporarySitePauses,
        tabId,
        changeInfo.url,
      );

      if (state.pageUrl === changeInfo.url) {
        return;
      }

      resetTabObservationState(state, changeInfo.url);
      void updateActionBadgeForTab(
        state,
        temporarySitePauses,
        settingsCache,
        actionBadgeUpdates,
      );
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      tabObservations.delete(tabId);
      requestDecisions.deleteTab(tabId);
      temporarySitePauses.delete(tabId);
      actionBadgeUpdates.remove(tabId);
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

interface RequestDecisionDetails {
  requestId: string;
  tabId: number;
  url: string;
  type: string;
}

function decideWebRequest(
  details: RequestDecisionDetails,
  pageUrl: string | null | undefined,
  sitePaused: boolean,
  settings: TrackerBlockerSettings,
  filterEngine: FilterEngine,
): RequestDecision {
  const context = normalizeRequestContext({
    requestId: details.requestId,
    tabId: details.tabId,
    pageUrl,
    documentUrl: getRequestStringProperty(details, "documentUrl"),
    originUrl: getRequestOriginUrl(details),
    initiator: getRequestInitiator(details),
    requestUrl: details.url,
    requestType: details.type,
  });
  const filterMatch = EASYPRIVACY_MATCHING_ENABLED
    ? filterEngine.match({
        requestId: context.requestId,
        tabId: context.tabId,
        url: context.requestUrl,
        sourceUrl: context.sourceUrl,
        type: context.requestType,
      })
    : null;

  return decideRequest({
    context,
    sitePaused,
    domainOverrides: settings.domainOverrides,
    easyPrivacyEnabled: EASYPRIVACY_MATCHING_ENABLED,
    filterMatch,
  });
}

async function loadPackagedEasyPrivacyArtifact() {
  const [artifactResponse, metadataResponse] = await Promise.all([
    fetch(browser.runtime.getURL("/filter-data/easyprivacy.engine")),
    fetch(browser.runtime.getURL("/filter-data/easyprivacy.metadata.json")),
  ]);

  if (!artifactResponse.ok || !metadataResponse.ok) {
    throw new Error("Packaged EasyPrivacy data is unavailable.");
  }

  return {
    artifact: new Uint8Array(await artifactResponse.arrayBuffer()),
    metadata: await metadataResponse.json(),
  };
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

async function initializeActionBadge(): Promise<void> {
  await Promise.all([
    safelyUpdateActionBadge(
      () => browser.action.setBadgeBackgroundColor({ color: "#f59e0b" }),
    ),
    safelyUpdateActionBadge(
      () => browser.action.setBadgeTextColor({ color: "#111827" }),
    ),
  ]);
}

async function updateObservedActionBadges(
  tabObservations: Map<number, TabObservationState>,
  temporarySitePauses: Map<number, string>,
  settings: TrackerBlockerSettings,
  actionBadgeUpdates: ActionBadgeUpdateQueue,
): Promise<void> {
  await Promise.all(
    [...tabObservations.values()].map((state) =>
      updateActionBadgeForTab(
        state,
        temporarySitePauses,
        settings,
        actionBadgeUpdates,
      ),
    ),
  );
}

async function updateActionBadgeForTab(
  state: TabObservationState,
  temporarySitePauses: Map<number, string>,
  settings: TrackerBlockerSettings,
  actionBadgeUpdates: ActionBadgeUpdateQueue,
): Promise<void> {
  const sitePauseStatus = getSitePauseStatus(
    temporarySitePauses,
    state.tabId,
    state.pageUrl,
    settings,
  );
  const summary = summarizeTabObservation(state, {
    sitePaused: sitePauseStatus !== "active",
    domainOverrides: settings.domainOverrides,
  });
  try {
    await actionBadgeUpdates.update(
      state.tabId,
      summary.blockedCount,
      async (badge) => {
        await Promise.all([
          browser.action.setBadgeText({
            tabId: state.tabId,
            text: badge.text,
          }),
          browser.action.setTitle({
            tabId: state.tabId,
            title: badge.title,
          }),
        ]);
      },
    );
  } catch {
    // Badge UI is helpful but should never interfere with request blocking.
  }
}

async function safelyUpdateActionBadge(
  actionUpdate: () => Promise<void>,
): Promise<void> {
  try {
    await actionUpdate();
  } catch {
    // Badge UI is helpful but should never interfere with request blocking.
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

function getRequestParentFrameId(details: unknown): number | undefined {
  if (
    typeof details === "object" &&
    details !== null &&
    "parentFrameId" in details &&
    typeof details.parentFrameId === "number"
  ) {
    return details.parentFrameId;
  }

  return undefined;
}

function getRequestOriginUrl(details: unknown): string | undefined {
  return getRequestStringProperty(details, "originUrl");
}

function getRequestInitiator(details: unknown): string | undefined {
  return getRequestStringProperty(details, "initiator");
}

function getRequestDocumentUrl(details: unknown): string | undefined {
  return (
    getRequestStringProperty(details, "documentUrl") ??
    getRequestStringProperty(details, "originUrl")
  );
}

function getRequestStringProperty(
  details: unknown,
  property: "documentUrl" | "originUrl" | "initiator",
): string | undefined {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }

  const record = details as Record<string, unknown>;

  if (property in record && typeof record[property] === "string") {
    return record[property];
  }

  return undefined;
}
