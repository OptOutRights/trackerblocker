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
import type { DomainOverrideAction } from "../../shared/ruleDecisions";
import {
  type ObservedRequestRow,
  type RequestRelationship,
} from "../../shared/requestObservation";
import type { SitePauseMode, SitePauseStatus } from "../../storage/settings";
import { RefreshToast } from "./RefreshToast";

type BackgroundStatus = "checking" | "ready" | "unavailable";
type SettingsStatus = "ready" | "unavailable";
type PopupSummary = GetTabRequestSummaryResponse | null;
type RequestView = "summary" | "blocked" | "all";

function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === HEALTH_CHECK_RESPONSE &&
    "ok" in value &&
    value.ok === true &&
    "startedAt" in value &&
    typeof value.startedAt === "string"
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
    useState<SitePauseStatus>("active");
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

      const tabSite = formatUrlHost(tabs[0]?.url);
      const activeTab = tabs[0];
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

  const allRows = summary?.rows ?? [];
  const blockedRows = filterRows(allRows, "blocked");
  const visibleRows =
    requestView === "blocked"
      ? blockedRows
      : requestView === "all"
        ? allRows
        : [];
  const hasSystemIssue =
    backgroundStatus === "unavailable" || settingsStatus === "unavailable";

  return (
    <main class="tb-popup w-[380px] p-3 text-zinc-950">
      <section class="tb-shell">
        <DashboardHeader
          activeHost={activeHost}
          isUnavailable={backgroundStatus === "unavailable"}
          status={sitePauseStatus}
        />

        <MetricPanel
          blockedDomainCount={summary?.blockedCount ?? 0}
        />

        <PauseControls
          activeTabId={activeTabId}
          isDisabled={!activeSite || settingsStatus === "unavailable"}
          status={sitePauseStatus}
          onSetPause={updateSitePause}
        />

        <RequestActions
          blockedCount={blockedRows.length}
          currentView={requestView}
          totalCount={allRows.length}
          onChange={setRequestView}
        />

        {requestView !== "summary" && (
          <RequestRows
            expandedRowId={expandedRowId}
            rows={visibleRows}
            view={requestView}
            onSetDomainOverride={updateDomainOverride}
            onToggleRow={(rowId) =>
              setExpandedRowId((current) => (current === rowId ? null : rowId))
            }
          />
        )}

        {hasSystemIssue && (
          <SystemNotice
            backgroundStatus={backgroundStatus}
            settingsStatus={settingsStatus}
          />
        )}
      </section>
      <RefreshToast
        message={pauseRefreshHint}
        onDismiss={() => setPauseRefreshHint(null)}
        onRefresh={() => void refreshActiveTab()}
      />
    </main>
  );
}

function DashboardHeader({
  activeHost,
  isUnavailable,
  status,
}: {
  activeHost: string;
  isUnavailable: boolean;
  status: SitePauseStatus;
}) {
  const statusLabel = isUnavailable ? "Unavailable" : formatPauseStatus(status);

  return (
    <header class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-[13px] font-semibold text-zinc-900">TrackerBlocker</p>
        <div class="mt-2.5 flex min-w-0 items-center gap-2 text-sm text-zinc-600">
          <span class="tb-signal-dot" aria-hidden="true" />
          <span class="truncate font-medium text-zinc-900">{activeHost}</span>
        </div>
      </div>
      <span class={pauseStatusClass(isUnavailable ? "unavailable" : status)}>
        {statusLabel}
      </span>
    </header>
  );
}

function MetricPanel({
  blockedDomainCount,
}: {
  blockedDomainCount: number;
}) {
  return (
    <section class="tb-metric-panel mt-5" aria-label="Protection summary">
      <p class="tb-block-summary">
        <span class="font-semibold text-zinc-950">{blockedDomainCount}</span>
        <span>
          potential {blockedDomainCount === 1 ? "tracker" : "trackers"}{" "}
          <span class="tb-underlined-word">blocked</span>
        </span>
      </p>
    </section>
  );
}

function PauseControls({
  activeTabId,
  isDisabled,
  onSetPause,
  status,
}: {
  activeTabId: number | null;
  isDisabled: boolean;
  onSetPause: (mode: SitePauseMode) => Promise<void>;
  status: SitePauseStatus;
}) {
  if (status === "paused-always") {
    return (
      <div class="mt-3 flex">
        <PauseButton
          isDisabled={isDisabled}
          label="Resume protection"
          onClick={() => void onSetPause(null)}
        />
      </div>
    );
  }

  return (
    <div class="mt-3 grid grid-cols-2 gap-2">
      {status === "paused-once" ? (
        <PauseButton
          isDisabled={isDisabled}
          label="Resume protection"
          onClick={() => void onSetPause(null)}
        />
      ) : (
        <PauseButton
          isDisabled={isDisabled || activeTabId === null}
          label="Pause once"
          onClick={() => void onSetPause("once")}
        />
      )}
      <PauseButton
        isDisabled={isDisabled}
        label="Always pause"
        onClick={() => void onSetPause("always")}
      />
    </div>
  );
}

function PauseButton({
  isDisabled,
  label,
  onClick,
}: {
  isDisabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      class="tb-command-button"
      disabled={isDisabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RequestActions({
  blockedCount,
  currentView,
  onChange,
  totalCount,
}: {
  blockedCount: number;
  currentView: RequestView;
  onChange: (view: RequestView) => void;
  totalCount: number;
}) {
  return (
    <section class="mt-3 flex items-center gap-2" aria-label="Site inspection">
      <RequestActionButton
        count={blockedCount}
        isSelected={currentView === "blocked"}
        label="Blocked sites"
        onSelect={() =>
          onChange(currentView === "blocked" ? "summary" : "blocked")
        }
      />
      <RequestActionButton
        count={totalCount}
        isSelected={currentView === "all"}
        label="All sites"
        onSelect={() => onChange(currentView === "all" ? "summary" : "all")}
      />
    </section>
  );
}

function RequestActionButton({
  count,
  isSelected,
  label,
  onSelect,
}: {
  count: number;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      class={isSelected ? "tb-action-button is-selected" : "tb-action-button"}
      type="button"
      onClick={onSelect}
    >
      <span>{label}</span>
      <span>{count}</span>
    </button>
  );
}

function RequestRows({
  expandedRowId,
  onSetDomainOverride,
  onToggleRow,
  rows,
  view,
}: {
  expandedRowId: string | null;
  onSetDomainOverride: (
    domain: string,
    action: DomainOverrideAction | null,
  ) => Promise<void>;
  onToggleRow: (rowId: string) => void;
  rows: ObservedRequestRow[];
  view: Exclude<RequestView, "summary">;
}) {
  if (rows.length === 0) {
    return (
      <div class="tb-empty-panel mt-3">
        <p class="text-sm font-medium text-zinc-800">
          {view === "blocked"
            ? "No blocked sites on this page yet."
            : "No sites observed for this tab yet."}
        </p>
        <p class="mt-1 text-xs leading-snug text-zinc-500">
          {view === "blocked"
            ? "Open all sites to inspect allowed or uncataloged activity."
            : "Refresh the page to capture current requests."}
        </p>
      </div>
    );
  }

  return (
    <div class="mt-3 max-h-[320px] overflow-y-auto">
      <div class="grid gap-2">
        {rows.map((row) => (
          <RequestRow
            isExpanded={expandedRowId === row.id}
            key={row.id}
            row={row}
            onSetDomainOverride={onSetDomainOverride}
            onToggle={() => onToggleRow(row.id)}
          />
        ))}
      </div>
    </div>
  );
}

function filterRows(
  rows: ObservedRequestRow[],
  filter: RequestView,
): ObservedRequestRow[] {
  if (filter === "all" || filter === "summary") {
    return rows;
  }

  if (filter === "blocked") {
    return rows.filter((row) => row.status === "blocked");
  }

  return rows;
}

function formatOptimisticPauseStatus(mode: SitePauseMode): SitePauseStatus {
  switch (mode) {
    case "once":
      return "paused-once";
    case "always":
      return "paused-always";
    case null:
      return "active";
  }
}

function formatPauseStatus(status: SitePauseStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused-once":
      return "Paused once";
    case "paused-always":
      return "Paused always";
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

function SystemNotice({
  backgroundStatus,
  settingsStatus,
}: {
  backgroundStatus: BackgroundStatus;
  settingsStatus: SettingsStatus;
}) {
  return (
    <p class="mt-4 border-l-2 border-[#d9534f] bg-[#fff6f4] px-3 py-2 text-xs leading-snug text-[#7a2d2a]">
      Some extension services are unavailable. Background: {backgroundStatus};
      settings: {settingsStatus}.
    </p>
  );
}

function pauseStatusClass(status: SitePauseStatus | "unavailable"): string {
  const base = "tb-status-pill";

  switch (status) {
    case "active":
      return `${base} is-active`;
    case "paused-once":
    case "paused-always":
      return `${base} is-paused`;
    case "unavailable":
      return `${base} is-unavailable`;
  }
}

function RequestRow({
  isExpanded,
  onSetDomainOverride,
  onToggle,
  row,
}: {
  isExpanded: boolean;
  onSetDomainOverride: (
    domain: string,
    action: DomainOverrideAction | null,
  ) => Promise<void>;
  onToggle: () => void;
  row: ObservedRequestRow;
}) {
  const selectedOverride = getSelectedOverride(row);
  const canOverride = row.relationship === "third-party";

  return (
    <article class={requestRowClass(row.status)}>
      <button
        aria-expanded={isExpanded}
        class="flex w-full items-start justify-between gap-3 text-left"
        type="button"
        onClick={onToggle}
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-zinc-950">
            {row.displayName}
          </p>
          <p class="mt-1 text-xs text-zinc-500">
            {formatRelationship(row.relationship)} -{" "}
            {formatCategory(row.category)}
            {row.entity ? ` by ${row.entity}` : ""} -{" "}
            {row.requestTypes.join(", ")}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <span class={statusBadgeClass(row.status)}>{row.requestCount}</span>
          <p class="mt-1 text-xs font-medium text-zinc-500">
            {formatStatus(row.status)}
          </p>
        </div>
      </button>

      {isExpanded && (
        <div class="mt-3 border-t border-zinc-200/80 pt-3 text-xs text-zinc-600">
          <dl class="grid gap-2">
            <DetailRow
              label="Entity"
              value={row.entity ?? "Not in local catalog"}
            />
            <DetailRow label="Explanation" value={row.explanation} />
            <DetailRow
              label="Request types"
              value={row.requestTypes.join(", ")}
            />
            <DetailRow
              label="Rule source"
              value={formatRuleSource(row.ruleSource)}
            />
          </dl>

          {canOverride && (
            <div class="mt-3 grid grid-cols-3 overflow-hidden border border-zinc-200 bg-white">
              <OverrideButton
                isSelected={selectedOverride === "auto"}
                label="Auto"
                onSelect={() =>
                  void onSetDomainOverride(row.displayName, null)
                }
              />
              <OverrideButton
                isSelected={selectedOverride === "block"}
                label="Block"
                onSelect={() =>
                  void onSetDomainOverride(row.displayName, "block")
                }
              />
              <OverrideButton
                isSelected={selectedOverride === "allow"}
                label="Allow"
                onSelect={() =>
                  void onSetDomainOverride(row.displayName, "allow")
                }
              />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="grid grid-cols-[88px_1fr] gap-2">
      <dt class="font-medium text-zinc-500">{label}</dt>
      <dd class="text-zinc-800">{value}</dd>
    </div>
  );
}

function OverrideButton({
  isSelected,
  label,
  onSelect,
}: {
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isSelected}
      class={`px-2 py-2 font-medium transition ${
        isSelected
          ? "bg-[#dff5ff] text-zinc-950"
          : "bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
      type="button"
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function getSelectedOverride(
  row: ObservedRequestRow,
): DomainOverrideAction | "auto" {
  if (row.ruleSource === "blocked-by-user") {
    return "block";
  }

  if (row.ruleSource === "allowed-by-user") {
    return "allow";
  }

  return "auto";
}

function formatRelationship(relationship: RequestRelationship): string {
  switch (relationship) {
    case "third-party":
      return "third party";
    case "first-party":
      return "first party";
    case "unknown":
      return "unknown";
  }
}

function formatCategory(category: ObservedRequestRow["category"]): string {
  switch (category) {
    case "advertising":
      return "likely advertising";
    case "analytics":
      return "likely analytics";
    case "session-replay":
      return "likely session replay";
    case "social":
      return "likely social";
    case "payment":
      return "likely payment";
    case "security":
      return "likely security";
    case "cdn":
      return "likely CDN";
    case "unknown":
      return "unknown";
  }
}

function formatRuleSource(source: ObservedRequestRow["ruleSource"]): string {
  switch (source) {
    case "automatic":
      return "Automatic";
    case "blocked-by-user":
      return "Blocked by user";
    case "allowed-by-user":
      return "Allowed by user";
    case "site-paused":
      return "Allowed because site is paused";
  }
}

function formatStatus(status: ObservedRequestRow["status"]): string {
  switch (status) {
    case "blocked":
      return "blocked";
    case "allowed":
      return "allowed";
    case "allowed-paused":
      return "paused";
  }
}

function requestRowClass(status: ObservedRequestRow["status"]): string {
  const base = "tb-request-row";

  switch (status) {
    case "blocked":
      return `${base} is-blocked`;
    case "allowed":
      return `${base} is-allowed`;
    case "allowed-paused":
      return `${base} is-paused`;
  }
}

function statusBadgeClass(status: ObservedRequestRow["status"]): string {
  const base =
    "inline-flex min-w-8 justify-center border px-2 py-1 text-xs font-semibold leading-none";

  switch (status) {
    case "blocked":
      return `${base} border-[#5db7dd] bg-[#dff5ff] text-zinc-950`;
    case "allowed":
      return `${base} border-zinc-200 bg-white text-zinc-700`;
    case "allowed-paused":
      return `${base} border-[#9fcbd6] bg-[#e8f8fb] text-zinc-800`;
  }
}
