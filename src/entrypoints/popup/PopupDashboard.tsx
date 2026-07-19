import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type {
  ObservedRequestRow,
  TabRequestSummary,
} from "../../shared/requestObservation";
import type { RuntimeSitePauseStatus } from "../../messaging/requestSummary";
import type { SitePauseMode } from "../../storage/settings";
import { RequestRows } from "./RequestRows";

export type BackgroundStatus = "checking" | "ready" | "unavailable";
export type SettingsStatus = "ready" | "unavailable";
export type RequestView = "summary" | "blocked" | "all";

export function PopupDashboard({
  activeHost,
  activeTabId,
  backgroundStatus,
  expandedRowId,
  isPauseDisabled,
  onChangeRequestView,
  onSetDomainOverride,
  onSetPause,
  onToggleRow,
  requestView,
  summary,
  settingsStatus,
  sitePauseStatus,
}: {
  activeHost: string;
  activeTabId: number | null;
  backgroundStatus: BackgroundStatus;
  expandedRowId: string | null;
  isPauseDisabled: boolean;
  onChangeRequestView: (view: RequestView) => void;
  onSetDomainOverride: (
    domain: string,
    action: DomainOverrideAction | null,
  ) => Promise<void>;
  onSetPause: (mode: SitePauseMode) => Promise<void>;
  onToggleRow: (rowId: string) => void;
  requestView: RequestView;
  summary: TabRequestSummary | null;
  settingsStatus: SettingsStatus;
  sitePauseStatus: RuntimeSitePauseStatus;
}) {
  const rows = summary?.rows ?? [];
  const blockedRows = filterRows(rows, "blocked");
  const visibleRows =
    requestView === "blocked"
      ? blockedRows
      : requestView === "all"
        ? rows
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

        <ProtectionSummary summary={summary} />

        <PauseControls
          activeTabId={activeTabId}
          isDisabled={isPauseDisabled}
          status={sitePauseStatus}
          onSetPause={onSetPause}
        />

        <RequestActions
          blockedCount={summary?.hostCounts.blocked ?? 0}
          countsAreLowerBounds={summary?.hostCounts.lowerBound ?? false}
          currentView={requestView}
          totalCount={summary?.hostCounts.observed ?? 0}
          onChange={onChangeRequestView}
        />

        {requestView !== "summary" && (
          <RequestRows
            expandedRowId={expandedRowId}
            rows={visibleRows}
            view={requestView}
            onSetDomainOverride={onSetDomainOverride}
            onToggleRow={onToggleRow}
          />
        )}

        {summary?.hostRowsTruncated && (
          <p class="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
            Host details are truncated. Request totals remain complete; host
            counts are lower bounds and {summary.omittedRequestCount} requests
            are omitted from rows.
          </p>
        )}

        {summary?.activeRequestEvidenceTruncated && (
          <p class="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
            Active-request correlation evidence was truncated to stay within
            memory limits. Recorded request and action totals remain unchanged.
          </p>
        )}

        {hasSystemIssue && (
          <SystemNotice
            backgroundStatus={backgroundStatus}
            settingsStatus={settingsStatus}
          />
        )}
      </section>
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
  status: RuntimeSitePauseStatus;
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

function ProtectionSummary({
  summary,
}: {
  summary: TabRequestSummary | null;
}) {
  const requestCounts = summary?.requestCounts ?? {
    total: 0,
    blocked: 0,
    restricted: 0,
    allowed: 0,
  };
  const blockedHostCount = summary?.hostCounts.blocked ?? 0;
  const hostSuffix = summary?.hostCounts.lowerBound ? "+" : "";

  return (
    <section class="tb-metric-panel mt-5" aria-label="Protection summary">
      <p class="tb-block-summary">
        <span class="font-semibold text-zinc-950">{requestCounts.blocked}</span>
        <span>
          blocked {requestCounts.blocked === 1 ? "request" : "requests"}{" "}
          across {blockedHostCount}
          {hostSuffix} blocked {blockedHostCount === 1 ? "host" : "hosts"}
        </span>
      </p>
      <p class="mt-2 text-xs leading-snug text-zinc-500">
        {requestCounts.restricted} restricted, {requestCounts.allowed} allowed,{" "}
        {requestCounts.total} observed locally.
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
  status: RuntimeSitePauseStatus;
}) {
  if (status === "unknown") {
    return (
      <div class="mt-3 flex">
        <PauseButton
          isDisabled
          label="Settings unavailable"
          onClick={() => undefined}
        />
      </div>
    );
  }

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
  countsAreLowerBounds,
  currentView,
  onChange,
  totalCount,
}: {
  blockedCount: number;
  countsAreLowerBounds: boolean;
  currentView: RequestView;
  onChange: (view: RequestView) => void;
  totalCount: number;
}) {
  return (
    <section class="mt-3 flex items-center gap-2" aria-label="Site inspection">
      <RequestActionButton
        count={blockedCount}
        countIsLowerBound={countsAreLowerBounds}
        isSelected={currentView === "blocked"}
        label="Blocked hosts"
        onSelect={() =>
          onChange(currentView === "blocked" ? "summary" : "blocked")
        }
      />
      <RequestActionButton
        count={totalCount}
        countIsLowerBound={countsAreLowerBounds}
        isSelected={currentView === "all"}
        label="All hosts"
        onSelect={() => onChange(currentView === "all" ? "summary" : "all")}
      />
    </section>
  );
}

function RequestActionButton({
  count,
  countIsLowerBound,
  isSelected,
  label,
  onSelect,
}: {
  count: number;
  countIsLowerBound: boolean;
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
      <span>
        {count}
        {countIsLowerBound ? "+" : ""}
      </span>
    </button>
  );
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

function filterRows(
  rows: ObservedRequestRow[],
  filter: RequestView,
): ObservedRequestRow[] {
  if (filter === "all" || filter === "summary") {
    return rows;
  }

  if (filter === "blocked") {
    return rows.filter((row) => row.actionCounts.blocked > 0);
  }

  return rows;
}

function formatPauseStatus(status: RuntimeSitePauseStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused-once":
      return "Paused once";
    case "paused-always":
      return "Paused always";
    case "unknown":
      return "Degraded";
  }
}

function pauseStatusClass(
  status: RuntimeSitePauseStatus | "unavailable",
): string {
  const base = "tb-status-pill";

  switch (status) {
    case "active":
      return `${base} is-active`;
    case "paused-once":
    case "paused-always":
      return `${base} is-paused`;
    case "unavailable":
    case "unknown":
      return `${base} is-unavailable`;
  }
}
