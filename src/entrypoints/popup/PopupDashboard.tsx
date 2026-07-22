import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type {
  HostRequestDetails,
  ObservedRequestRow,
  TabRequestSummary,
} from "../../shared/requestObservation";
import type {
  EnforcementSummary,
  RuntimeSitePauseStatus,
} from "../../messaging/requestSummary";
import type { SitePauseMode } from "../../storage/settings";
import { RequestRows } from "./RequestRows";

export type BackgroundStatus = "checking" | "ready" | "unavailable";
export type SettingsStatus = "ready" | "unavailable";
export type RequestView = "summary" | "blocked" | "all";
type DashboardSummary = TabRequestSummary & { enforcement: EnforcementSummary };

export function PopupDashboard({
  activeHost,
  activeTabId,
  backgroundStatus,
  expandedRowId,
  hostDetails,
  hostDetailsStatus,
  isPauseDisabled,
  onChangeRequestView,
  onOpenSettings,
  onSetDomainOverride,
  onSetSiteAllow,
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
  hostDetails: HostRequestDetails | null;
  hostDetailsStatus: "idle" | "loading" | "ready" | "unavailable";
  isPauseDisabled: boolean;
  onChangeRequestView: (view: RequestView) => void;
  onOpenSettings: () => void;
  onSetDomainOverride: (
    domain: string,
    action: DomainOverrideAction | null,
  ) => Promise<void>;
  onSetSiteAllow: (
    domain: string,
    allowed: boolean,
    rowId: string,
  ) => Promise<void>;
  onSetPause: (mode: SitePauseMode) => Promise<void>;
  onToggleRow: (rowId: string) => void;
  requestView: RequestView;
  summary: DashboardSummary | null;
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
    <main class="tb-popup text-zinc-950">
      <section class="tb-shell">
        <div class="tb-fixed-region">
          <DashboardHeader
            activeHost={activeHost}
            isUnavailable={backgroundStatus === "unavailable"}
            onOpenSettings={onOpenSettings}
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

          {hasSystemIssue && (
            <SystemNotice
              backgroundStatus={backgroundStatus}
              onOpenSettings={onOpenSettings}
              settingsStatus={settingsStatus}
            />
          )}
        </div>

        {requestView !== "summary" && (
          <div class="tb-scroll-region">
            <RequestRows
              areSettingsControlsDisabled={settingsStatus === "unavailable"}
              expandedRowId={expandedRowId}
              hostDetails={hostDetails}
              hostDetailsStatus={hostDetailsStatus}
              rows={visibleRows}
              view={requestView}
              onSetDomainOverride={onSetDomainOverride}
              onSetSiteAllow={onSetSiteAllow}
              onToggleRow={onToggleRow}
            />
            {summary?.hostRowsTruncated && (
              <p class="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
                Showing a limited host list. {summary.omittedRequestCount} requests
                are omitted below; totals above are complete.
              </p>
            )}

            {summary?.activeRequestEvidenceTruncated && (
              <p class="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
                Some older request details are incomplete. Blocking and totals
                are unaffected.
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function DashboardHeader({
  activeHost,
  isUnavailable,
  onOpenSettings,
  status,
}: {
  activeHost: string;
  isUnavailable: boolean;
  onOpenSettings: () => void;
  status: RuntimeSitePauseStatus;
}) {
  const statusLabel = isUnavailable ? "Unavailable" : formatPauseStatus(status);

  return (
    <header class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      <p class="min-w-0 text-[13px] font-semibold text-zinc-900">
        TrackerBlocker
      </p>
      <span class={pauseStatusClass(isUnavailable ? "unavailable" : status)}>
        {statusLabel}
      </span>
      <div class="flex min-w-0 items-center gap-2 text-sm text-zinc-600">
        <span class="tb-signal-dot" aria-hidden="true" />
        <span class="truncate font-normal text-zinc-600">{activeHost}</span>
      </div>
      <button
        aria-label="Open TrackerBlocker settings"
        class="tb-settings-button justify-self-end"
        title="Open settings"
        type="button"
        onClick={onOpenSettings}
      >
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          viewBox="0 0 24 24"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </header>
  );
}

function ProtectionSummary({
  summary,
}: {
  summary: DashboardSummary | null;
}) {
  const presentation = formatProtectionSummary(summary);

  return (
    <section class="tb-metric-panel mt-1" aria-label="Protection summary">
      <p class="tb-metric-value">{presentation.value}</p>
      <p class="tb-metric-label">{presentation.label}</p>
    </section>
  );
}

export function formatProtectionSummary(
  summary: DashboardSummary | null,
): { value: string; label: string } {
  if (!summary) {
    return { value: "—", label: "Checking blocked count" };
  }

  if (summary.enforcement.status === "paused") {
    return { value: "—", label: "Protection paused" };
  }

  if (
    summary.enforcement.status !== "active" ||
    summary.enforcement.blockedCount === null
  ) {
    return { value: "—", label: "Blocked count unavailable" };
  }

  const blockedCount = summary.enforcement.blockedCount;
  return {
    value: String(blockedCount),
    label: blockedCount === 1 ? "Request blocked" : "Requests blocked",
  };
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
      <div class="tb-command-grid is-single mt-3">
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
      <div class="tb-command-grid is-single mt-3">
        <PauseButton
          isDisabled={isDisabled}
          label="Resume protection"
          tone="primary"
          onClick={() => void onSetPause(null)}
        />
      </div>
    );
  }

  return (
    <div class="tb-command-grid mt-3">
      {status === "paused-once" ? (
        <PauseButton
          isDisabled={isDisabled}
          label="Resume protection"
          tone="primary"
          onClick={() => void onSetPause(null)}
        />
      ) : (
        <PauseButton
          isDisabled={isDisabled || activeTabId === null}
          label="Pause once"
          tone="primary"
          onClick={() => void onSetPause("once")}
        />
      )}
      <PauseButton
        isDisabled={isDisabled}
        label="Always pause"
        tone="secondary"
        onClick={() => void onSetPause("always")}
      />
    </div>
  );
}

function PauseButton({
  isDisabled,
  label,
  onClick,
  tone = "neutral",
}: {
  isDisabled: boolean;
  label: string;
  onClick: () => void;
  tone?: "neutral" | "primary" | "secondary";
}) {
  return (
    <button
      class={`tb-command-button is-${tone}`}
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
    <section class="mt-4" aria-labelledby="host-actions-heading">
      <h2 id="host-actions-heading" class="tb-section-label">
        Hosts
      </h2>
      <div class="tb-action-grid">
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
      </div>
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
      <span class="tb-action-count">
        {count}
        {countIsLowerBound ? "+" : ""}
      </span>
      <span class="tb-action-label">{label}</span>
    </button>
  );
}

function SystemNotice({
  backgroundStatus,
  onOpenSettings,
  settingsStatus,
}: {
  backgroundStatus: BackgroundStatus;
  onOpenSettings: () => void;
  settingsStatus: SettingsStatus;
}) {
  return (
    <div class="mt-4 border-l-2 border-[#d9534f] bg-[#fff6f4] px-3 py-2 text-xs leading-snug text-[#7a2d2a]">
      <p>
        Protection needs attention. Background: {backgroundStatus}; settings:{" "}
        {settingsStatus}.
      </p>
      <button
        class="mt-1 font-medium text-[#7a2d2a] underline decoration-[#d9534f] underline-offset-2"
        type="button"
        onClick={onOpenSettings}
      >
        Open troubleshooting
      </button>
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
