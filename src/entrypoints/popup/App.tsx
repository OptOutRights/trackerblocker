import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_MESSAGE,
  HEALTH_CHECK_RESPONSE,
  type HealthCheckResponse,
} from "../../messaging/health";
import {
  GET_TAB_REQUEST_SUMMARY_MESSAGE,
  GET_TAB_REQUEST_SUMMARY_RESPONSE,
  isGetTabRequestSummaryResponse,
  type GetTabRequestSummaryResponse,
  type RuntimeSitePauseStatus,
} from "../../messaging/requestSummary";
import {
  GET_SETTINGS_MESSAGE,
  SETTINGS_RESPONSE,
  SET_DOMAIN_OVERRIDE_MESSAGE,
  UPDATE_SITE_PAUSE_MESSAGE,
  isSettingsErrorResponse,
  isSettingsResponse,
} from "../../messaging/settings";
import { formatUrlHost } from "../../shared/domains";
import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type { SitePauseMode } from "../../storage/settings";
import {
  PopupDashboard,
  type BackgroundStatus,
  type RequestView,
  type SettingsStatus,
} from "./PopupDashboard";
import { RefreshToast } from "./RefreshToast";

type PopupSummary = GetTabRequestSummaryResponse | null;

function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
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
    "settings" in value &&
    typeof value.settings === "object" &&
    value.settings !== null &&
    "health" in value.settings &&
    (value.settings.health === "loading" ||
      value.settings.health === "ready" ||
      value.settings.health === "degraded") &&
    "hasUsableSnapshot" in value.settings &&
    typeof value.settings.hasUsableSnapshot === "boolean"
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
  const [requestView, setRequestView] = useState<RequestView>("summary");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadPopupState() {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!isMounted) {
        return;
      }

      const activeTab = tabs[0];
      const tabSite = formatUrlHost(activeTab?.url);
      setActiveHost(tabSite ?? "Unavailable");
      setActiveSite(tabSite);
      setActiveTabId(typeof activeTab?.id === "number" ? activeTab.id : null);

      try {
        const healthResponse = await browser.runtime.sendMessage({
          type: HEALTH_CHECK_MESSAGE,
        });

        setBackgroundStatus(
          isHealthCheckResponse(healthResponse) ? "ready" : "unavailable",
        );

        if (typeof activeTab?.id === "number") {
          const summaryResponse = await browser.runtime.sendMessage({
            type: GET_TAB_REQUEST_SUMMARY_MESSAGE,
            tabId: activeTab.id,
            pageUrl: activeTab.url,
          });

          if (
            isMounted &&
            isGetTabRequestSummaryResponse(summaryResponse) &&
            summaryResponse.type === GET_TAB_REQUEST_SUMMARY_RESPONSE
          ) {
            setSummary(summaryResponse);
            setSitePauseStatus(summaryResponse.sitePauseStatus);
          }
        }

        const settingsResponse = await browser.runtime.sendMessage({
          type: GET_SETTINGS_MESSAGE,
        });

        if (!isMounted) {
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

  return (
    <>
      <PopupDashboard
        activeHost={activeHost}
        activeTabId={activeTabId}
        backgroundStatus={backgroundStatus}
        expandedRowId={expandedRowId}
        isPauseDisabled={!activeSite || settingsStatus === "unavailable"}
        requestView={requestView}
        summary={summary}
        settingsStatus={settingsStatus}
        sitePauseStatus={sitePauseStatus}
        onChangeRequestView={setRequestView}
        onSetDomainOverride={updateDomainOverride}
        onSetPause={updateSitePause}
        onToggleRow={(rowId) =>
          setExpandedRowId((current) => (current === rowId ? null : rowId))
        }
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
