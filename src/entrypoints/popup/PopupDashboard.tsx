import type { DomainOverrideAction } from "../../shared/ruleDecisions";
import type { ObservedRequestRow } from "../../shared/requestObservation";
import type { SitePauseMode, SitePauseStatus } from "../../storage/settings";
import { RequestRows } from "./RequestRows";

export type BackgroundStatus = "checking" | "ready" | "unavailable";
export type SettingsStatus = "ready" | "unavailable";
export type RequestView = "summary" | "blocked" | "review" | "all";

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
  rows,
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
  rows: ObservedRequestRow[];
  settingsStatus: SettingsStatus;
  sitePauseStatus: SitePauseStatus;
}) {
  const blockedRows = filterRows(rows, "blocked");
  const reviewRows = filterRows(rows, "review");
  const visibleRows =
    requestView === "blocked"
      ? blockedRows
      : requestView === "review"
        ? reviewRows
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

        <ProtectionSummary rows={rows} />

        <PauseControls
          activeTabId={activeTabId}
          isDisabled={isPauseDisabled}
          status={sitePauseStatus}
          onSetPause={onSetPause}
        />

        <RequestActions
          blockedCount={blockedRows.length}
          currentView={requestView}
          reviewCount={reviewRows.length}
          totalCount={rows.length}
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

function ProtectionSummary({ rows }: { rows: ObservedRequestRow[] }) {
  const blockedDomainCount = rows.filter((row) => row.status === "blocked").length;
  const restrictedDomainCount = rows.filter(
    (row) => row.status === "restricted",
  ).length;
  const uncatalogedCount = rows.filter(
    (row) => row.relationship === "third-party" && row.category === "unknown",
  ).length;

  return (
    <section class="tb-metric-panel mt-5" aria-label="Protection summary">
      <p class="tb-block-summary">
        <span class="font-semibold text-zinc-950">{blockedDomainCount}</span>
        <span>
          potential {blockedDomainCount === 1 ? "tracker" : "trackers"}{" "}
          <span class="tb-underlined-word">blocked</span>
        </span>
      </p>
      <p class="mt-2 text-xs leading-snug text-zinc-500">
        {restrictedDomainCount} restricted, {uncatalogedCount} uncataloged,{" "}
        {rows.length} observed locally.
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
  reviewCount,
  totalCount,
}: {
  blockedCount: number;
  currentView: RequestView;
  onChange: (view: RequestView) => void;
  reviewCount: number;
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
        count={reviewCount}
        isSelected={currentView === "review"}
        label="Review"
        onSelect={() => onChange(currentView === "review" ? "summary" : "review")}
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
    return rows.filter((row) => row.status === "blocked");
  }

  if (filter === "review") {
    return rows.filter((row) => {
      const visibilityIsWeak = row.context.visibilityNotes.some(
        (note) => note !== "visible-request",
      );

      return (
        row.status === "restricted" ||
        (row.relationship === "third-party" && row.category === "unknown") ||
        visibilityIsWeak
      );
    });
  }

  return rows;
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
