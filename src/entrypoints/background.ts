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
  type EnforcementSummary,
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
import {
  ActionBadgeUpdateQueue,
  type ActionBadgeState,
} from "../shared/actionBadge";
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
  isEnforceablePageUrl,
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
  EnforcementLedger,
  canRestoreEnforcementEntry,
  recordCancellationDecision,
} from "../storage/enforcementLedger";
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
  enforcementLedgerFromSessionState,
  pausesFromSessionState,
  readSessionStateWithin,
  sessionStateFromRuntime,
  writeSessionState,
} from "../storage/sessionState";
import { SettingsRuntime } from "../storage/settingsRuntime";

export default defineBackground(() => {
  const startedAt = new Date().toISOString();
  const tabObservations = new Map<number, TabObservationState>();
  const actionBadgeUpdates = new ActionBadgeUpdateQueue();
  const enforcementLedger = new EnforcementLedger();
  const filterEngine = new FilterEngine();
  const settingsRuntime = new SettingsRuntime();
  const temporarySitePauses = new Map<number, string>();
  const removedTabIds = new Set<number>();
  const tabPageUrls = new TabPageUrlCache();
  const tabDocumentIds = new Map<number, string>();
  const persistableDocumentTabIds = new Set<number>();
  const pendingTopLevelNavigations = new Set<number>();
  const settingsMutations = new SettingsMutationQueue();
  let sessionStateReady: Promise<void> = Promise.resolve();
  let sessionWriteTail: Promise<void> = Promise.resolve();
  let filterEngineReady: Promise<void> = Promise.resolve();
  let hostPermissionReady: Promise<boolean> = Promise.resolve(false);
  let hostPermissionGranted = false;

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
        void sendTabRequestSummary(message.tabId, message.pageUrl, sendResponse);
        return true;
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
                invalidateEnforcementForTab(message.tabId, "paused");
                await persistRuntimeSessionState(message.tabId);
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
            if (message.mode === null || message.mode === "always") {
              await sessionStateReady;
              if (typeof message.tabId === "number") {
                temporarySitePauses.delete(message.tabId);
              }
              await invalidateEnforcementForSite(
                message.site,
                message.mode === "always" ? "paused" : "unavailable",
              );
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
            await invalidateAllEnforcementCounts();
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
            filterEngineReady,
            hostPermissionReady,
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
              void persistRuntimeSessionState(details.tabId);
            }
            tabPageUrls.set(details.tabId, details.url);
            resetTabObservationState(state, details.url);
            pendingTopLevelNavigations.add(details.tabId);
            tabDocumentIds.delete(details.tabId);
            persistableDocumentTabIds.delete(details.tabId);
            enforcementLedger.markUnavailable(details.tabId);
            await persistRuntimeSessionState(details.tabId);
            // Until the navigation commits, the old page is still visible and
            // must not inherit the new document's zero count.
            await updateActionBadgeForEnforcement(
              details.tabId,
              { status: "unavailable", blockedCount: null },
            );
          }

          recordUnobservedRequestAttempt(
            state,
            details.requestId,
            decision,
            details.timeStamp,
          );
          enforceGlobalActiveRequestLimit(tabObservations.values());
          if (decision.action === "block") {
            const cancellation = await recordEnforcedBlock(details.tabId);
            return { cancel: cancellation.cancel };
          }
          return undefined;
        }

        const [settings, requestPageUrl] = await Promise.all([
          settingsRuntime.waitForUsableSettings(),
          tabPageUrls.resolve(details.tabId, loadCurrentTabPageUrl),
          sessionStateReady,
          filterEngineReady,
          hostPermissionReady,
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
        if (decision.action === "block") {
          const cancellation = await recordEnforcedBlock(
            details.tabId,
            !staleTopLevelDocumentRequest,
          );
          return { cancel: cancellation.cancel };
        }

        return undefined;
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
      },
      { urls: ["<all_urls>"] },
    );

    browser.webRequest.onErrorOccurred.addListener(
      (details) => {
        if (details.tabId < 0) {
          return;
        }

        if (
          details.type === "main_frame" &&
          pendingTopLevelNavigations.delete(details.tabId)
        ) {
          tabDocumentIds.delete(details.tabId);
          persistableDocumentTabIds.delete(details.tabId);
          enforcementLedger.markUnavailable(details.tabId);
          void persistRuntimeSessionState(details.tabId);
          void updateActionBadgeForEnforcement(details.tabId, {
            status: "unavailable",
            blockedCount: null,
          });
        }

        const state = tabObservations.get(details.tabId);

        if (!state) {
          return;
        }

        recordRequestFailed(state, {
          requestId: details.requestId,
          timestamp: details.timeStamp,
        });
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
        void persistRuntimeSessionState(tabId);
      }

      // URL-only changes can be history.pushState or fragment navigation.
      // Full-document resets are owned by main-frame and webNavigation events.
      state.pageUrl = changeInfo.url;
    });

    browser.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0 || details.tabId < 0) {
        return;
      }

      const previousDocumentId = tabDocumentIds.get(details.tabId);
      pendingTopLevelNavigations.delete(details.tabId);
      const nativeDocumentId = getStringProperty(details, "documentId");
      const documentId = nativeDocumentId ?? createEphemeralDocumentId();
      tabDocumentIds.set(details.tabId, documentId);
      if (nativeDocumentId) {
        persistableDocumentTabIds.add(details.tabId);
      } else {
        persistableDocumentTabIds.delete(details.tabId);
      }
      // Firefox resets per-tab action presentation on navigation.
      actionBadgeUpdates.remove(details.tabId);
      tabPageUrls.set(details.tabId, details.url);

      const state = getTabObservationState(
        tabObservations,
        details.tabId,
        details.url,
      );
      if (
        previousDocumentId !== undefined &&
        previousDocumentId !== documentId
      ) {
        resetTabObservationState(state, details.url);
      } else {
        state.pageUrl = details.url;
      }

      void establishEnforcementForCommittedDocument(
        details.tabId,
        documentId,
        details.url,
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
      tabDocumentIds.delete(tabId);
      persistableDocumentTabIds.delete(tabId);
      pendingTopLevelNavigations.delete(tabId);
      enforcementLedger.remove(tabId);
      temporarySitePauses.delete(tabId);
      void persistRuntimeSessionState();
      actionBadgeUpdates.remove(tabId);
    });

    browser.permissions.onRemoved.addListener(() => {
      void refreshHostPermission().then((granted) => {
        if (!granted) {
          void invalidateAllEnforcementCounts();
        }
      });
    });

    browser.permissions.onAdded.addListener(() => {
      hostPermissionReady = refreshHostPermission();
    });

    console.info(`[Tracker Blocker] Background ready at ${startedAt}`);
  };

  startBackgroundRuntime({
    registerListeners,
    startSettings: () => {
      settingsRuntime.start(readSettings);
      hostPermissionReady = refreshHostPermission();
      sessionStateReady = readSessionStateWithin()
        .then(async (sessionState) => {
          if (!sessionState) {
            tabDocumentIds.clear();
            persistableDocumentTabIds.clear();
            enforcementLedger.restore(true, new Map());
            return;
          }

          temporarySitePauses.clear();
          enforcementLedger.restore(
            sessionState.enforcementLedgerInitialized,
            enforcementLedgerFromSessionState(sessionState),
          );
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
          const ledgerChanged = await reconcileRestoredEnforcementLedger();
          if (discardedStalePause || ledgerChanged) {
            await persistRuntimeSessionState();
          }
        });
    },
    startFilterEngine: () => {
      filterEngineReady = filterEngine.initialize(
        loadPackagedEasyPrivacyArtifact,
      );
    },
    initializeBadge: () => {
      void initializeActionBadgePresentation();
    },
  });

  async function persistRuntimeSessionState(
    affectedTabId?: number,
  ): Promise<boolean> {
    const snapshot = sessionStateFromRuntime(
      temporarySitePauses,
      enforcementLedger.initialized,
      new Map(
        [...enforcementLedger.entries()].filter(([tabId]) =>
          persistableDocumentTabIds.has(tabId),
        ),
      ),
    );
    const write = sessionWriteTail.then(() => writeSessionState(snapshot));
    sessionWriteTail = write.then(
      () => undefined,
      () => undefined,
    );
    try {
      await write;
      return true;
    } catch {
      if (affectedTabId !== undefined) {
        enforcementLedger.markUnavailable(affectedTabId);
        persistableDocumentTabIds.delete(affectedTabId);
        await updateActionBadgeForEnforcement(affectedTabId, {
          status: "unavailable",
          blockedCount: null,
        });
      }
      return false;
    }
  }

  async function reconcileRestoredEnforcementLedger(): Promise<boolean> {
    const tabs = await browser.tabs.query({}).catch(() => []);
    const openTabIds = new Set<number>();
    let changed = false;

    tabDocumentIds.clear();
    persistableDocumentTabIds.clear();

    for (const tab of tabs) {
      if (typeof tab.id !== "number") {
        continue;
      }

      openTabIds.add(tab.id);
      const stored = enforcementLedger.entries().get(tab.id);
      if (!stored) {
        continue;
      }

      const currentDocument = await loadCurrentTopLevelDocument(tab.id);
      if (
        canRestoreEnforcementEntry({
          storedDocumentId: stored.documentId,
          currentDocumentId: currentDocument?.documentId ?? null,
          pageUrl: currentDocument?.url ?? null,
        })
      ) {
        tabDocumentIds.set(tab.id, stored.documentId);
        persistableDocumentTabIds.add(tab.id);
      } else {
        enforcementLedger.remove(tab.id);
        changed = true;
      }
    }

    for (const tabId of enforcementLedger.entries().keys()) {
      if (!openTabIds.has(tabId)) {
        enforcementLedger.remove(tabId);
        changed = true;
      }
    }

    if (!enforcementLedger.initialized) {
      enforcementLedger.finishInitialization();
      changed = true;
    }

    return changed;
  }

  async function refreshHostPermission(): Promise<boolean> {
    try {
      hostPermissionGranted = await browser.permissions.contains({
        origins: ["<all_urls>"],
      });
    } catch {
      hostPermissionGranted = false;
    }
    return hostPermissionGranted;
  }

  function isProtectionRuntimeAvailable(): boolean {
    return (
      hostPermissionGranted &&
      settingsRuntime.snapshot.settings !== null &&
      (!EASYPRIVACY_MATCHING_ENABLED || filterEngine.health === "ready")
    );
  }

  function resolveDocumentId(tabId: number): string | null {
    return tabDocumentIds.get(tabId) ?? null;
  }

  async function recordEnforcedBlock(
    tabId: number,
    countForCurrentDocument = true,
  ) {
    if (!countForCurrentDocument) {
      return {
        cancel: true as const,
        count: { status: "unavailable" as const, blockedCount: null },
      };
    }

    const documentId = resolveDocumentId(tabId);
    const cancellation = await recordCancellationDecision({
      ledger: enforcementLedger,
      tabId,
      documentId,
      countingAvailable: isProtectionRuntimeAvailable(),
      // The helper owns document-scoped failure invalidation and cleanup. A
      // lifecycle write for a newer document must not be invalidated here.
      persist: () => persistRuntimeSessionState(),
    });
    if (
      resolveDocumentId(tabId) === documentId &&
      !pendingTopLevelNavigations.has(tabId)
    ) {
      await updateActionBadgeForEnforcement(tabId, cancellation.count);
    }
    return cancellation;
  }

  async function establishEnforcementForCommittedDocument(
    tabId: number,
    documentId: string,
    pageUrl: string,
  ): Promise<void> {
    const settings = settingsRuntime.snapshot.settings;
    const pauseStatus = settings
      ? getSitePauseStatus(temporarySitePauses, tabId, pageUrl, settings)
      : "unknown";

    if (
      isEnforceablePageUrl(pageUrl) &&
      pauseStatus === "active" &&
      isProtectionRuntimeAvailable()
    ) {
      enforcementLedger.startDocument(tabId, documentId);
    } else {
      enforcementLedger.markUnavailable(tabId);
      persistableDocumentTabIds.delete(tabId);
    }

    await persistRuntimeSessionState(tabId);
    await updateActionBadgeForCurrentTab(tabId);
  }

  function invalidateEnforcementForTab(
    tabId: number,
    status: "paused" | "unavailable" = "unavailable",
  ): void {
    enforcementLedger.markUnavailable(tabId);
    persistableDocumentTabIds.delete(tabId);
    void updateActionBadgeForEnforcement(tabId, {
      status,
      blockedCount: null,
    });
  }

  async function invalidateAllEnforcementCounts(): Promise<void> {
    const affected = [
      ...new Set([
        ...tabDocumentIds.keys(),
        ...enforcementLedger.entries().keys(),
      ]),
    ];
    for (const tabId of affected) {
      enforcementLedger.markUnavailable(tabId);
      persistableDocumentTabIds.delete(tabId);
    }
    await persistRuntimeSessionState();
    await Promise.all(
      affected.map((tabId) =>
        updateActionBadgeForEnforcement(tabId, {
          status: "unavailable",
          blockedCount: null,
        }),
      ),
    );
  }

  async function invalidateEnforcementForSite(
    site: string,
    status: "paused" | "unavailable",
  ): Promise<void> {
    const normalizedSite = normalizeSettingsKey(site);
    const tabs = await browser.tabs.query({}).catch(() => []);
    const affected = tabs.flatMap((tab) =>
      typeof tab.id === "number" &&
      normalizeSiteFromUrl(tab.url ?? tabPageUrls.get(tab.id)) === normalizedSite
        ? [tab.id]
        : [],
    );

    for (const tabId of affected) {
      enforcementLedger.markUnavailable(tabId);
      persistableDocumentTabIds.delete(tabId);
    }
    await persistRuntimeSessionState();
    await Promise.all(
      affected.map((tabId) =>
        updateActionBadgeForEnforcement(tabId, {
          status,
          blockedCount: null,
        }),
      ),
    );
  }

  async function getEnforcementSummary(
    tabId: number,
    sitePauseStatus: RuntimeSitePauseStatus,
    pageUrl: string | null | undefined,
  ): Promise<EnforcementSummary> {
    if (sitePauseStatus === "paused-once" || sitePauseStatus === "paused-always") {
      if (enforcementLedger.hasEntry(tabId)) {
        enforcementLedger.markUnavailable(tabId);
        persistableDocumentTabIds.delete(tabId);
        await persistRuntimeSessionState(tabId);
      }
      return { status: "paused", blockedCount: null };
    }

    await Promise.all([sessionStateReady, filterEngineReady, hostPermissionReady]);
    if (
      pendingTopLevelNavigations.has(tabId) ||
      !isEnforceablePageUrl(pageUrl)
    ) {
      if (enforcementLedger.hasEntry(tabId)) {
        enforcementLedger.markUnavailable(tabId);
        persistableDocumentTabIds.delete(tabId);
        void persistRuntimeSessionState(tabId);
      }
      return { status: "unavailable", blockedCount: null };
    }
    const documentId = resolveDocumentId(tabId);
    if (!documentId || !isProtectionRuntimeAvailable()) {
      if (enforcementLedger.hasEntry(tabId)) {
        enforcementLedger.markUnavailable(tabId);
        persistableDocumentTabIds.delete(tabId);
        void persistRuntimeSessionState(tabId);
      }
      return { status: "unavailable", blockedCount: null };
    }

    const count = enforcementLedger.getCount(tabId, documentId);
    if (count.status === "available") {
      return { status: "active", blockedCount: count.blockedCount };
    }

    if (enforcementLedger.hasEntry(tabId)) {
      enforcementLedger.markUnavailable(tabId);
      persistableDocumentTabIds.delete(tabId);
      void persistRuntimeSessionState(tabId);
    }
    return { status: "unavailable", blockedCount: null };
  }

  async function sendTabRequestSummary(
    tabId: number,
    pageUrl: string | null | undefined,
    sendResponse: (response: GetTabRequestSummaryResponse) => void,
  ): Promise<void> {
    await sessionStateReady;
    const state = getTabObservationState(tabObservations, tabId, pageUrl);
    const settings = settingsRuntime.snapshot.settings;
    const sitePauseStatus: RuntimeSitePauseStatus = settings
      ? getSitePauseStatus(
          temporarySitePauses,
          tabId,
          state.pageUrl ?? pageUrl,
          settings,
        )
      : "unknown";
    const summary = summarizeTabObservation(state, {
      domainOverrides: settings?.domainOverrides,
      siteAllows: settings?.siteAllows,
    });
    const enforcement = await getEnforcementSummary(
      tabId,
      sitePauseStatus,
      state.pageUrl ?? pageUrl,
    );
    await updateActionBadgeForEnforcement(tabId, toBadgeCountStatus(enforcement));

    sendResponse({
      type: GET_TAB_REQUEST_SUMMARY_RESPONSE,
      sitePauseStatus,
      settingsHealth: settingsRuntime.snapshot.health,
      enforcement,
      ...summary,
    });
  }

  async function updateActionBadgeForCurrentTab(tabId: number): Promise<void> {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const settings = settingsRuntime.snapshot.settings;
    const pauseStatus = settings
      ? getSitePauseStatus(temporarySitePauses, tabId, tab?.url, settings)
      : "unknown";
    const enforcement = await getEnforcementSummary(
      tabId,
      pauseStatus,
      tab?.url,
    );
    await updateActionBadgeForEnforcement(tabId, toBadgeCountStatus(enforcement));
  }

  async function updateActionBadgeForEnforcement(
    tabId: number,
    state: ActionBadgeState,
  ): Promise<void> {
    try {
      await actionBadgeUpdates.update(tabId, state, async (badge) => {
        await Promise.all([
          browser.action.setBadgeText({ tabId, text: badge.text }),
          browser.action.setTitle({ tabId, title: badge.title }),
        ]);
      });
    } catch {
      // Badge UI is helpful but should never interfere with request blocking.
    }
  }

  async function initializeActionBadgePresentation(): Promise<void> {
    await Promise.all([sessionStateReady, filterEngineReady, hostPermissionReady]);
    await initializeActionBadgeColors();
    const tabs = await browser.tabs.query({}).catch(() => []);
    await Promise.all(
      tabs.flatMap((tab) =>
        typeof tab.id === "number"
          ? [updateActionBadgeForCurrentTab(tab.id)]
          : [],
      ),
    );
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

async function initializeActionBadgeColors(): Promise<void> {
  await Promise.all([
    safelyUpdateActionBadge(
      () => browser.action.setBadgeBackgroundColor({ color: "#2864fc" }),
    ),
    safelyUpdateActionBadge(
      () => browser.action.setBadgeTextColor({ color: "#ffffff" }),
    ),
  ]);
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

async function loadCurrentTopLevelDocument(
  tabId: number,
): Promise<{ documentId: string | null; url: string | null } | null> {
  try {
    const frame = await browser.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!frame) {
      return null;
    }

    return {
      documentId: getStringProperty(frame, "documentId") ?? null,
      url: getStringProperty(frame, "url") ?? null,
    };
  } catch {
    return null;
  }
}

function createEphemeralDocumentId(): string {
  return crypto.randomUUID();
}

function toBadgeCountStatus(
  enforcement: EnforcementSummary,
): ActionBadgeState {
  if (
    enforcement.status === "active" &&
    enforcement.blockedCount !== null
  ) {
    return {
      status: "available",
      blockedCount: enforcement.blockedCount,
    };
  }

  return {
    status: enforcement.status === "paused" ? "paused" : "unavailable",
    blockedCount: null,
  };
}

function synchronizeTabObservationPage(
  state: TabObservationState,
  pageUrl: string | null,
): void {
  if (pageUrl && state.pageUrl !== pageUrl) {
    state.pageUrl = pageUrl;
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
  return getStringProperty(details, property);
}

function getStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (property in record && typeof record[property] === "string") {
    return record[property];
  }

  return undefined;
}
