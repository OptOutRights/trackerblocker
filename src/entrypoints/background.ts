import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_RESPONSE,
  isHealthCheckMessage,
  type HealthCheckResponse,
} from "../messaging/health";
import {
  GET_HOST_REQUEST_DETAILS_RESPONSE,
  GET_TAB_REQUEST_SUMMARY_RESPONSE,
  isGetHostRequestDetailsMessage,
  isGetTabRequestSummaryMessage,
  type GetTabRequestSummaryResponse,
  type RuntimeSitePauseStatus,
} from "../messaging/requestSummary";
import {
  SETTINGS_ERROR_RESPONSE,
  SETTINGS_RESPONSE,
  isGetSettingsMessage,
  isResetSettingsMessage,
  isSetDomainOverrideMessage,
  isSetSiteAllowMessage,
  isUpdateSitePauseMessage,
  type SettingsErrorResponse,
  type SettingsResponse,
  type SetSiteAllowMessage,
} from "../messaging/settings";
import { ActionBadgeUpdateQueue } from "../shared/actionBadge";
import { startBackgroundRuntime } from "../shared/backgroundStartup";
import { EASYPRIVACY_MATCHING_ENABLED } from "../shared/buildFlags";
import { formatUrlHost } from "../shared/domains";
import { FilterEngine } from "../shared/filterEngine";
import {
  createTabObservationState,
  enforceGlobalActiveRequestLimit,
  getActiveRequestDecision,
  recordObservedRequest,
  recordRequestCompleted,
  recordRequestFailed,
  recordRequestRedirect,
  recordUnobservedRequestAttempt,
  resetTabObservationState,
  summarizeHostRequestDetails,
  summarizeTabObservation,
  type TabObservationState,
} from "../shared/requestObservation";
import { applyRequestHeaderRestriction } from "../shared/requestRestriction";
import {
  TabPageUrlCache,
  isStaleTopLevelDocumentRequest,
} from "../shared/tabPageUrls";
import {
  createSettingsUnavailableDecision,
  decideMainFrameRequest,
  decideRequest,
  normalizeRequestContext,
  type RequestDecision,
} from "../shared/requestDecisions";
import {
  SETTINGS_STORAGE_KEY,
  normalizeSettings,
  normalizeSettingsKey,
  readSettings,
  SettingsMutationQueue,
  type SitePauseStatus,
  type TrackerBlockerSettings,
} from "../storage/settings";
import {
  pausesFromSessionState,
  readSessionStateWithin,
  sessionStateFromPauses,
  writeSessionState,
} from "../storage/sessionState";
import { SettingsRuntime } from "../storage/settingsRuntime";

export default defineBackground(() => {
  const startedAt = new Date().toISOString();
  const tabObservations = new Map<number, TabObservationState>();
  const actionBadgeUpdates = new ActionBadgeUpdateQueue();
  const filterEngine = new FilterEngine();
  const settingsRuntime = new SettingsRuntime();
  const temporarySitePauses = new Map<number, string>();
  const removedTabIds = new Set<number>();
  const tabPageUrls = new TabPageUrlCache();
  const settingsMutations = new SettingsMutationQueue();
  let sessionStateReady: Promise<void> = Promise.resolve();
  let sessionWriteTail: Promise<void> = Promise.resolve();

  const registerListeners = () => {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isHealthCheckMessage(message)) {
        void sendHealthResponse(
          startedAt,
          filterEngine,
          settingsRuntime,
          sendResponse,
        );
        return true;
      }

      if (isGetTabRequestSummaryMessage(message)) {
        const state = getTabObservationState(
          tabObservations,
          message.tabId,
          message.pageUrl,
        );
        const settings = settingsRuntime.snapshot.settings;
        const sitePauseStatus: RuntimeSitePauseStatus = settings
          ? getSitePauseStatus(
              temporarySitePauses,
              message.tabId,
              state.pageUrl ?? message.pageUrl,
              settings,
            )
          : "unknown";
        const summary = summarizeTabObservation(state, {
          domainOverrides: settings?.domainOverrides,
          siteAllows: settings?.siteAllows,
        });
        const response: GetTabRequestSummaryResponse = {
          type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
          sitePauseStatus,
          settingsHealth: settingsRuntime.snapshot.health,
          ...summary,
        };

        sendResponse(response);
        return false;
      }

      if (isGetHostRequestDetailsMessage(message)) {
        const state = tabObservations.get(message.tabId);
        sendResponse({
          type: GET_HOST_REQUEST_DETAILS_RESPONSE,
          details: state
            ? summarizeHostRequestDetails(
                state,
                message.generation,
                message.rowId,
              )
            : null,
        });
        return false;
      }

      if (isGetSettingsMessage(message)) {
        void sendSettingsResponse(
          () => getUsableRuntimeSettings(settingsRuntime),
          sendResponse,
          undefined,
          () => settingsRuntime.degrade("storage-unavailable"),
        );
        return true;
      }

      if (isUpdateSitePauseMessage(message)) {
        if (message.mode === "once") {
          void sendSettingsResponse(
            () => getUsableRuntimeSettings(settingsRuntime),
            sendResponse,
            async (settings) => {
              if (typeof message.tabId === "number") {
                await sessionStateReady;
                await requireCurrentTabSite(message.tabId, message.site);
                setTemporarySitePause(
                  temporarySitePauses,
                  message.tabId,
                  message.site,
                );
                await persistTemporarySitePauses();
              }
            },
            () => settingsRuntime.degrade("storage-unavailable"),
          );
          return true;
        }

        void sendSettingsResponse(
          () =>
            settingsMutations.update({
              type: "site-pause",
              site: message.site,
              paused: message.mode === "always",
            }),
          sendResponse,
          async (settings) => {
            settingsRuntime.accept(settings);
            if (
              (message.mode === null || message.mode === "always") &&
              typeof message.tabId === "number"
            ) {
              await sessionStateReady;
              temporarySitePauses.delete(message.tabId);
              await persistTemporarySitePauses();
            }
          },
          () => settingsRuntime.degrade("storage-unavailable"),
        );
        return true;
      }

      if (isSetDomainOverrideMessage(message)) {
        void sendSettingsResponse(
          () =>
            settingsMutations.update({
              type: "domain-override",
              domain: message.domain,
              action: message.action,
            }),
          sendResponse,
          (settings) => {
            settingsRuntime.accept(settings);
          },
          () => settingsRuntime.degrade("storage-unavailable"),
        );
        return true;
      }

      if (isSetSiteAllowMessage(message)) {
        void sendSettingsResponse(
          async () => {
            await requireCurrentSiteAllowContext(message, tabObservations);
            return settingsMutations.update({
              type: "site-allow",
              site: message.site,
              domain: message.domain,
              allowed: message.allowed,
            });
          },
          sendResponse,
          (settings) => settingsRuntime.accept(settings),
          () => settingsRuntime.degrade("storage-unavailable"),
        );
        return true;
      }

      if (isResetSettingsMessage(message)) {
        void sendSettingsResponse(
          () => settingsMutations.reset(),
          sendResponse,
          async (settings) => {
            settingsRuntime.accept(settings);
            await sessionStateReady;
            temporarySitePauses.clear();
            await persistTemporarySitePauses();
          },
          () => settingsRuntime.degrade("storage-unavailable"),
        );
        return true;
      }

      return false;
    });

    // Firefox accepts a Promise from blocking webRequest listeners. WXT's
    // generated cross-browser type currently models only the synchronous form.
    browser.webRequest.onBeforeRequest.addListener(
      (async (details: Browser.webRequest.OnBeforeRequestDetails) => {
        if (details.tabId < 0) {
          return undefined;
        }
        removedTabIds.delete(details.tabId);
        settingsRuntime.retry(readSettings);

        if (details.type === "main_frame") {
          const [settings] = await Promise.all([
            settingsRuntime.waitForUsableSettings(),
            sessionStateReady,
          ]);
          const state = getTabObservationState(
            tabObservations,
            details.tabId,
            tabPageUrls.get(details.tabId),
          );
          const context = normalizeWebRequestContext(details, details.url);
          const sitePauseStatus = settings
            ? getSitePauseStatus(
                temporarySitePauses,
                details.tabId,
                details.url,
                settings,
              )
            : "unknown";
          const decision = settings
            ? decideMainFrameRequest({
                context,
                sitePaused: sitePauseStatus !== "active",
                domainOverrides: settings.domainOverrides,
              })
            : createSettingsUnavailableDecision(context);

          if (decision.action !== "block") {
            const clearedTemporaryPause = clearTemporaryPauseForNavigation(
              temporarySitePauses,
              details.tabId,
              details.url,
            );
            if (clearedTemporaryPause) {
              void persistTemporarySitePauses();
            }
            tabPageUrls.set(details.tabId, details.url);
            resetTabObservationState(state, details.url);
          }

          recordUnobservedRequestAttempt(
            state,
            details.requestId,
            decision,
            details.timeStamp,
          );
          enforceGlobalActiveRequestLimit(tabObservations.values());
          void updateActionBadgeForTab(
            state,
            actionBadgeUpdates,
          );
          return decision.action === "block" ? { cancel: true } : undefined;
        }

        const [settings, requestPageUrl] = await Promise.all([
          settingsRuntime.waitForUsableSettings(),
          tabPageUrls.resolve(details.tabId, loadCurrentTabPageUrl),
          sessionStateReady,
        ]);
        const state = getTabObservationState(
          tabObservations,
          details.tabId,
          requestPageUrl,
        );
        synchronizeTabObservationPage(state, requestPageUrl);
        const observationGeneration = state.generation;
        const explicitDocumentUrl = getRequestStringProperty(
          details,
          "documentUrl",
        );
        const staleTopLevelDocumentRequest =
          isStaleTopLevelDocumentRequest({
            frameId: details.frameId,
            currentDocumentUrls: tabPageUrls.getCurrentDocumentUrls(
              details.tabId,
            ),
            documentUrl: explicitDocumentUrl,
          });
        const context = normalizeWebRequestContext(details, requestPageUrl);
        const sitePauseStatus = settings
          ? getSitePauseStatus(
              temporarySitePauses,
              details.tabId,
              requestPageUrl,
              settings,
            )
          : "unknown";
        const decision = settings
          ? decideWebRequest(
              details,
              requestPageUrl,
              sitePauseStatus !== "active",
              settings,
              filterEngine,
            )
          : createSettingsUnavailableDecision(context);

        if (
          state.generation === observationGeneration &&
          !staleTopLevelDocumentRequest
        ) {
          recordObservedRequest(
            state,
            {
              requestId: details.requestId,
              tabId: details.tabId,
              frameId: details.frameId,
              parentFrameId: getRequestParentFrameId(details),
              pageUrl: requestPageUrl,
              documentUrl: getRequestDocumentUrl(details),
              originUrl: getRequestOriginUrl(details),
              initiator: getRequestInitiator(details),
              requestUrl: details.url,
              requestType: details.type,
              timestamp: details.timeStamp,
              sitePaused: isPausedSiteStatus(sitePauseStatus),
              domainOverrides: settings?.domainOverrides,
            },
            { decision },
          );
        } else {
          recordUnobservedRequestAttempt(
            state,
            details.requestId,
            decision,
            details.timeStamp,
          );
        }
        enforceGlobalActiveRequestLimit(tabObservations.values());
        void updateActionBadgeForTab(
          state,
          actionBadgeUpdates,
        );

        return decision.action === "block" ? { cancel: true } : undefined;
      }) as unknown as (
        details: Browser.webRequest.OnBeforeRequestDetails,
      ) => Browser.webRequest.BlockingResponse | undefined,
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
        const decision = getActiveRequestDecision(state, details.requestId);

        if (!decision?.headerRestriction || !details.requestHeaders) {
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
          actionBadgeUpdates,
        );
      },
      { urls: ["<all_urls>"] },
    );

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!changeInfo.url) {
        return;
      }
      tabPageUrls.setSameDocument(tabId, changeInfo.url);

      const state = getTabObservationState(tabObservations, tabId);
      const clearedTemporaryPause = clearTemporaryPauseForNavigation(
        temporarySitePauses,
        tabId,
        changeInfo.url,
      );
      if (clearedTemporaryPause) {
        void persistTemporarySitePauses();
      }

      if (state.pageUrl === changeInfo.url) {
        return;
      }

      resetTabObservationState(state, changeInfo.url);
      void updateActionBadgeForTab(
        state,
        actionBadgeUpdates,
      );
    });

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !(SETTINGS_STORAGE_KEY in changes)) {
        return;
      }

      settingsRuntime.accept(
        normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue),
      );
    });

    browser.tabs.onRemoved.addListener((tabId) => {
      removedTabIds.add(tabId);
      tabPageUrls.remove(tabId);
      tabObservations.delete(tabId);
      temporarySitePauses.delete(tabId);
      void persistTemporarySitePauses();
      actionBadgeUpdates.remove(tabId);
    });

    console.info(`[TrackerBlocker] Background ready at ${startedAt}`);
  };

  startBackgroundRuntime({
    registerListeners,
    startSettings: () => {
      settingsRuntime.start(readSettings);
      sessionStateReady = readSessionStateWithin()
        .then(async (sessionState) => {
          if (!sessionState) {
            return;
          }

          temporarySitePauses.clear();
          const restoredPauses = await Promise.all(
            [...pausesFromSessionState(sessionState)].map(
              async ([tabId, site]) => {
                const currentUrl = await tabPageUrls.resolve(
                  tabId,
                  loadCurrentTabPageUrl,
                );
                return {
                  tabId,
                  site,
                  isCurrent:
                    !removedTabIds.has(tabId) &&
                    normalizeSiteFromUrl(currentUrl) === site,
                };
              },
            ),
          );
          let discardedStalePause = false;
          for (const pause of restoredPauses) {
            if (!pause.isCurrent) {
              discardedStalePause = true;
              continue;
            }
            temporarySitePauses.set(pause.tabId, pause.site);
          }
          if (discardedStalePause) {
            void persistTemporarySitePauses();
          }
        });
    },
    startFilterEngine: () => {
      void filterEngine.initialize(loadPackagedEasyPrivacyArtifact);
    },
    initializeBadge: () => {
      void initializeActionBadge();
    },
  });

  function persistTemporarySitePauses(): Promise<void> {
    const snapshot = sessionStateFromPauses(temporarySitePauses);
    const write = sessionWriteTail.then(() => writeSessionState(snapshot));
    sessionWriteTail = write.then(
      () => undefined,
      () => undefined,
    );
    return write.then(() => undefined);
  }
});

async function sendSettingsResponse(
  loadSettings: () => Promise<Omit<SettingsResponse, "type">>,
  sendResponse: (response: SettingsResponse | SettingsErrorResponse) => void,
  onSettingsLoaded?: (
    settings: TrackerBlockerSettings,
  ) => void | Promise<void>,
  onSettingsError?: () => void,
): Promise<void> {
  try {
    const settings = await loadSettings();
    await onSettingsLoaded?.(settings);

    sendResponse({
      type: SETTINGS_RESPONSE,
      ...settings,
    });
  } catch (error) {
    if (!(error instanceof StalePageError)) {
      onSettingsError?.();
    }
    sendResponse({
      type: SETTINGS_ERROR_RESPONSE,
      reason:
        error instanceof StalePageError ? "stale-page" : "storage-unavailable",
    });
  }
}

class StalePageError extends Error {}

async function requireCurrentTabSite(tabId: number, site: string): Promise<void> {
  const expectedSite = normalizeSettingsKey(site);

  if (!expectedSite) {
    throw new StalePageError();
  }

  try {
    const tab = await browser.tabs.get(tabId);
    if (normalizeSiteFromUrl(tab.url) !== expectedSite) {
      throw new StalePageError();
    }
  } catch (error) {
    if (error instanceof StalePageError) {
      throw error;
    }

    throw new StalePageError();
  }
}

async function requireCurrentSiteAllowContext(
  message: SetSiteAllowMessage,
  tabObservations: ReadonlyMap<number, TabObservationState>,
): Promise<void> {
  const hasContext =
    message.tabId !== undefined ||
    message.generation !== undefined ||
    message.rowId !== undefined;

  if (!hasContext) {
    return;
  }

  const state = tabObservations.get(message.tabId!);
  const expectedSite = normalizeSettingsKey(message.site);
  const expectedDomain = normalizeSettingsKey(message.domain);
  const row = state?.rows.get(message.rowId!);

  if (
    !state ||
    state.generation !== message.generation ||
    normalizeSiteFromUrl(state.pageUrl) !== expectedSite ||
    row?.host !== expectedDomain
  ) {
    throw new StalePageError();
  }

  await requireCurrentTabSite(message.tabId!, expectedSite);
}

async function sendHealthResponse(
  startedAt: string,
  filterEngine: FilterEngine,
  settingsRuntime: SettingsRuntime,
  sendResponse: (response: HealthCheckResponse) => void,
): Promise<void> {
  let hostPermissionGranted = false;

  try {
    hostPermissionGranted = await browser.permissions.contains({
      origins: ["<all_urls>"],
    });
  } catch {
    // Diagnostics remain truthful when permission introspection is unavailable.
  }

  sendResponse({
    type: HEALTH_CHECK_RESPONSE,
    ok: true,
    startedAt,
    easyPrivacy: {
      matchingEnabled: EASYPRIVACY_MATCHING_ENABLED,
      engineHealth: filterEngine.health,
      degradedReason: filterEngine.degradedReason,
      provenance: filterEngine.provenance,
      hostPermissionGranted,
    },
    settings: {
      health: settingsRuntime.snapshot.health,
      hasUsableSnapshot: settingsRuntime.snapshot.settings !== null,
      degradedReason: settingsRuntime.snapshot.degradedReason,
    },
  });
}

async function getUsableRuntimeSettings(
  settingsRuntime: SettingsRuntime,
): Promise<TrackerBlockerSettings> {
  settingsRuntime.retry(readSettings);
  const settings = await settingsRuntime.waitForUsableSettings();

  if (!settings) {
    throw new Error("Settings are unavailable.");
  }

  return settings;
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
  const context = normalizeWebRequestContext(details, pageUrl);
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
    siteAllows: settings.siteAllows,
    easyPrivacyEnabled: EASYPRIVACY_MATCHING_ENABLED,
    filterMatch,
  });
}

function normalizeWebRequestContext(
  details: RequestDecisionDetails,
  pageUrl: string | null | undefined,
) {
  return normalizeRequestContext({
    requestId: details.requestId,
    tabId: details.tabId,
    pageUrl,
    documentUrl: getRequestStringProperty(details, "documentUrl"),
    originUrl: getRequestOriginUrl(details),
    initiator: getRequestInitiator(details),
    requestUrl: details.url,
    requestType: details.type,
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

function isPausedSiteStatus(status: RuntimeSitePauseStatus): boolean {
  return status === "paused-once" || status === "paused-always";
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
): boolean {
  const pausedSite = temporarySitePauses.get(tabId);

  if (!pausedSite) {
    return false;
  }

  if (normalizeSiteFromUrl(nextUrl) !== pausedSite) {
    temporarySitePauses.delete(tabId);
    return true;
  }

  return false;
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

  try {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs.flatMap((tab) =>
        typeof tab.id === "number"
          ? [
              safelyUpdateActionBadge(() =>
                browser.action.setBadgeText({ tabId: tab.id, text: "" }),
              ),
              safelyUpdateActionBadge(() =>
                browser.action.setTitle({
                  tabId: tab.id,
                  title: "TrackerBlocker",
                }),
              ),
            ]
          : [],
      ),
    );
  } catch {
    // Stale badge cleanup is best-effort and must not affect protection.
  }
}

async function updateActionBadgeForTab(
  state: TabObservationState,
  actionBadgeUpdates: ActionBadgeUpdateQueue,
): Promise<void> {
  try {
    await actionBadgeUpdates.update(
      state.tabId,
      state.requestCounts.blocked,
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

async function loadCurrentTabPageUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await browser.tabs.get(tabId);
    return typeof tab.url === "string" && tab.url ? tab.url : null;
  } catch {
    return null;
  }
}

function synchronizeTabObservationPage(
  state: TabObservationState,
  pageUrl: string | null,
): void {
  if (pageUrl && state.pageUrl !== pageUrl) {
    resetTabObservationState(state, pageUrl);
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
