import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_MESSAGE,
  isHealthCheckResponse,
} from "../../messaging/health";
import {
  GET_HOST_REQUEST_DETAILS_MESSAGE,
  GET_HOST_REQUEST_DETAILS_RESPONSE,
  GET_TAB_REQUEST_SUMMARY_MESSAGE,
  GET_TAB_REQUEST_SUMMARY_RESPONSE,
  isGetHostRequestDetailsResponse,
  isGetTabRequestSummaryResponse,
  type GetTabRequestSummaryResponse,
  type RuntimeSitePauseStatus,
} from "../../messaging/requestSummary";
import {
  GET_SETTINGS_MESSAGE,
  SETTINGS_RESPONSE,
  SET_DOMAIN_OVERRIDE_MESSAGE,
  SET_SITE_ALLOW_MESSAGE,
  UPDATE_SITE_PAUSE_MESSAGE,
  isSettingsErrorResponse,
  isSettingsResponse,
} from "../../messaging/settings";
import { formatUrlHost } from "../../shared/domains";
import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type { HostRequestDetails } from "../../shared/requestObservation";
import type { SitePauseMode } from "../../storage/settings";
import {
  PopupDashboard,
  type BackgroundStatus,
  type RequestView,
  type SettingsStatus,
} from "./PopupDashboard";
import { RefreshToast } from "./RefreshToast";

type PopupSummary = GetTabRequestSummaryResponse | null;

type HostDetailsStatus = "idle" | "loading" | "ready" | "unavailable";

export interface HostDetailsRequestIdentity {
  tabId: number;
  generation: number;
  rowId: string;
}

export interface HostDetailsState {
  request: HostDetailsRequestIdentity | null;
  status: HostDetailsStatus;
  details: HostRequestDetails | null;
}

export type HostDetailsAction =
  | { type: "start"; request: HostDetailsRequestIdentity }
  | {
      type: "resolve";
      request: HostDetailsRequestIdentity;
      details: HostRequestDetails | null;
    }
  | { type: "unavailable"; request: HostDetailsRequestIdentity }
  | { type: "clear" }
  | { type: "clear-unless-tab"; tabId: number | null }
  | { type: "clear-unless-summary"; tabId: number; generation: number };

export const IDLE_HOST_DETAILS_STATE: HostDetailsState = {
  request: null,
  status: "idle",
  details: null,
};

export function hostDetailsReducer(
  state: HostDetailsState,
  action: HostDetailsAction,
): HostDetailsState {
  if (action.type === "start") {
    return {
      request: action.request,
      status: "loading",
      details: null,
    };
  }

  if (action.type === "clear") {
    return IDLE_HOST_DETAILS_STATE;
  }

  if (action.type === "clear-unless-tab") {
    return state.request && state.request.tabId !== action.tabId
      ? IDLE_HOST_DETAILS_STATE
      : state;
  }

  if (action.type === "clear-unless-summary") {
    return state.request &&
      (state.request.tabId !== action.tabId ||
        state.request.generation !== action.generation)
      ? IDLE_HOST_DETAILS_STATE
      : state;
  }

  if (!hasSameHostDetailsIdentity(state.request, action.request)) {
    return state;
  }

  if (action.type === "unavailable") {
    return {
      request: action.request,
      status: "unavailable",
      details: null,
    };
  }

  if (
    !action.details ||
    !hasSameHostDetailsIdentity(action.details, action.request)
  ) {
    return {
      request: action.request,
      status: "unavailable",
      details: null,
    };
  }

  return {
    request: action.request,
    status: "ready",
    details: action.details,
  };
}

function hasSameHostDetailsIdentity(
  left: HostDetailsRequestIdentity | null,
  right: HostDetailsRequestIdentity,
): boolean {
  return Boolean(
    left &&
      left.tabId === right.tabId &&
      left.generation === right.generation &&
      left.rowId === right.rowId,
  );
}

export function App() {
  const [activeHost, setActiveHost] = useState("Checking...");
  const [activeSite, setActiveSite] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [backgroundStatus, setBackgroundStatus] =
    useState<BackgroundStatus>("checking");
  const [settingsStatus, setSettingsStatus] =
    useState<SettingsStatus>("ready");
  const [sitePauseStatus, setSitePauseStatus] =
    useState<RuntimeSitePauseStatus>("active");
  const [pauseRefreshHint, setPauseRefreshHint] = useState<string | null>(null);
  const [summary, setSummary] = useState<PopupSummary>(null);
  const [hostDetailsState, dispatchHostDetails] = useReducer(
    hostDetailsReducer,
    IDLE_HOST_DETAILS_STATE,
  );
  const [requestView, setRequestView] = useState<RequestView>("summary");
  const [reloadToken, setReloadToken] = useState(0);
  const popupLoadGeneration = useRef(0);
  const expandedRowId = hostDetailsState.request?.rowId ?? null;

  useEffect(() => {
    let isMounted = true;

    async function loadPopupState() {
      const loadGeneration = ++popupLoadGeneration.current;
      const isCurrentLoad = () =>
        isMounted && loadGeneration === popupLoadGeneration.current;
      const tabs = await browser.tabs
        .query({ active: true, currentWindow: true })
        .catch(() => null);

      if (!tabs) {
        if (isCurrentLoad()) {
          dispatchHostDetails({ type: "clear" });
          setActiveHost("Unavailable");
          setBackgroundStatus("unavailable");
          setSettingsStatus("unavailable");
        }
        return;
      }

      if (!isCurrentLoad()) {
        return;
      }

      const activeTab = tabs[0];
      const tabSite = formatUrlHost(activeTab?.url);
      setActiveHost(tabSite ?? "Unavailable");
      setActiveSite(tabSite);
      setActiveTabId(typeof activeTab?.id === "number" ? activeTab.id : null);
      dispatchHostDetails({
        type: "clear-unless-tab",
        tabId: typeof activeTab?.id === "number" ? activeTab.id : null,
      });

      try {
        const healthResponse = await browser.runtime.sendMessage({
          type: HEALTH_CHECK_MESSAGE,
        });

        if (!isCurrentLoad()) {
          return;
        }

        const validHealth = isHealthCheckResponse(healthResponse);
        setBackgroundStatus(validHealth ? "ready" : "unavailable");

        if (typeof activeTab?.id === "number") {
          const summaryResponse = await browser.runtime.sendMessage({
            type: GET_TAB_REQUEST_SUMMARY_MESSAGE,
            tabId: activeTab.id,
            pageUrl: activeTab.url,
          });

          if (
            isCurrentLoad() &&
            isGetTabRequestSummaryResponse(summaryResponse) &&
            summaryResponse.type === GET_TAB_REQUEST_SUMMARY_RESPONSE
          ) {
            dispatchHostDetails({
              type: "clear-unless-summary",
              tabId: summaryResponse.tabId,
              generation: summaryResponse.generation,
            });
            setSummary(summaryResponse);
            setSitePauseStatus(summaryResponse.sitePauseStatus);
          }
        }

        const settingsResponse = await browser.runtime.sendMessage({
          type: GET_SETTINGS_MESSAGE,
        });

        if (!isCurrentLoad()) {
          return;
        }

        if (
          isSettingsResponse(settingsResponse) &&
          settingsResponse.type === SETTINGS_RESPONSE
        ) {
          setSettingsStatus("ready");
        } else if (isSettingsErrorResponse(settingsResponse)) {
          setSettingsStatus("unavailable");
        }
      } catch {
        if (!isCurrentLoad()) {
          return;
        }

        setBackgroundStatus("unavailable");
        setSettingsStatus("unavailable");
      }
    }

    loadPopupState().catch(() => {
      if (!isMounted) {
        return;
      }

      setActiveHost("Unavailable");
      setBackgroundStatus("unavailable");
      setSettingsStatus("unavailable");
    });

    const refreshTimer = window.setInterval(() => {
      loadPopupState().catch(() => {
        if (!isMounted) {
          return;
        }

        setBackgroundStatus("unavailable");
        setSettingsStatus("unavailable");
      });
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [reloadToken]);

  async function updateSitePause(mode: SitePauseMode) {
    if (!activeSite) {
      return;
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: UPDATE_SITE_PAUSE_MESSAGE,
        site: activeSite,
        mode,
        tabId: activeTabId ?? undefined,
      });

      if (isSettingsErrorResponse(response) && response.reason === "stale-page") {
        setReloadToken((token) => token + 1);
        return;
      }

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setSettingsStatus("unavailable");
        return;
      }

      setSitePauseStatus(formatOptimisticPauseStatus(mode));
      setPauseRefreshHint(formatPauseModeRefreshHint(mode));
      setSettingsStatus("ready");
      setReloadToken((token) => token + 1);
    } catch {
      setSettingsStatus("unavailable");
    }
  }

  async function updateDomainOverride(
    domain: string,
    action: DomainOverrideAction | null,
  ) {
    try {
      const response = await browser.runtime.sendMessage({
        type: SET_DOMAIN_OVERRIDE_MESSAGE,
        domain,
        action,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setSettingsStatus("unavailable");
        return;
      }

      setSettingsStatus("ready");
      setReloadToken((token) => token + 1);
    } catch {
      setSettingsStatus("unavailable");
    }
  }

  async function updateSiteAllow(
    domain: string,
    allowed: boolean,
    rowId: string,
  ) {
    if (
      !activeSite ||
      activeTabId === null ||
      !summary ||
      summary.tabId !== activeTabId ||
      summary.siteHost !== activeSite ||
      !summary.rows.some((row) => row.id === rowId && row.host === domain)
    ) {
      setReloadToken((token) => token + 1);
      return;
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: SET_SITE_ALLOW_MESSAGE,
        site: activeSite,
        domain,
        allowed,
        tabId: activeTabId,
        generation: summary.generation,
        rowId,
      });

      if (isSettingsErrorResponse(response) && response.reason === "stale-page") {
        setReloadToken((token) => token + 1);
        return;
      }

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setSettingsStatus("unavailable");
        return;
      }

      setPauseRefreshHint("Refresh page to apply this site-specific change.");
      setSettingsStatus("ready");
      setReloadToken((token) => token + 1);
    } catch {
      setSettingsStatus("unavailable");
    }
  }

  async function toggleRow(rowId: string) {
    if (hostDetailsState.request?.rowId === rowId) {
      dispatchHostDetails({ type: "clear" });
      return;
    }

    if (activeTabId === null || !summary) {
      dispatchHostDetails({ type: "clear" });
      return;
    }

    const request: HostDetailsRequestIdentity = {
      tabId: activeTabId,
      generation: summary.generation,
      rowId,
    };
    dispatchHostDetails({ type: "start", request });

    try {
      const response = await browser.runtime.sendMessage({
        type: GET_HOST_REQUEST_DETAILS_MESSAGE,
        ...request,
      });
      if (
        isGetHostRequestDetailsResponse(response) &&
        response.type === GET_HOST_REQUEST_DETAILS_RESPONSE
      ) {
        dispatchHostDetails({
          type: "resolve",
          request,
          details: response.details,
        });
      } else {
        dispatchHostDetails({ type: "unavailable", request });
      }
    } catch {
      dispatchHostDetails({ type: "unavailable", request });
    }
  }

  async function refreshActiveTab() {
    try {
      if (activeTabId === null) {
        await browser.tabs.reload();
      } else {
        await browser.tabs.reload(activeTabId);
      }

      setPauseRefreshHint(null);
    } catch {
      setSettingsStatus("unavailable");
    }
  }

  async function openSettings() {
    try {
      await browser.runtime.openOptionsPage();
    } catch {
      setBackgroundStatus("unavailable");
    }
  }

  return (
    <>
      <PopupDashboard
        activeHost={activeHost}
        activeTabId={activeTabId}
        backgroundStatus={backgroundStatus}
        expandedRowId={expandedRowId}
        hostDetails={hostDetailsState.details}
        hostDetailsStatus={hostDetailsState.status}
        isPauseDisabled={!activeSite || settingsStatus === "unavailable"}
        requestView={requestView}
        summary={summary}
        settingsStatus={settingsStatus}
        sitePauseStatus={sitePauseStatus}
        onChangeRequestView={setRequestView}
        onOpenSettings={() => void openSettings()}
        onSetDomainOverride={updateDomainOverride}
        onSetSiteAllow={updateSiteAllow}
        onSetPause={updateSitePause}
        onToggleRow={(rowId) => void toggleRow(rowId)}
      />
      <RefreshToast
        message={pauseRefreshHint}
        onDismiss={() => setPauseRefreshHint(null)}
        onRefresh={() => void refreshActiveTab()}
      />
    </>
  );
}

function formatOptimisticPauseStatus(
  mode: SitePauseMode,
): RuntimeSitePauseStatus {
  switch (mode) {
    case "once":
      return "paused-once";
    case "always":
      return "paused-always";
    case null:
      return "active";
  }
}

function formatPauseModeRefreshHint(mode: SitePauseMode): string {
  switch (mode) {
    case null:
      return "Refresh page to apply protection.";
    case "once":
    case "always":
      return "Refresh page to reload affected requests.";
  }
}
