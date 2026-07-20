import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type { HealthCheckResponse } from "../../messaging/health";
import type {
  HostRequestDetails,
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
  diagnostics,
  expandedRowId,
  hostDetails,
  hostDetailsStatus,
  isPauseDisabled,
  onChangeRequestView,
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
  diagnostics: HealthCheckResponse | null;
  expandedRowId: string | null;
  hostDetails: HostRequestDetails | null;
  hostDetailsStatus: "idle" | "loading" | "ready" | "unavailable";
  isPauseDisabled: boolean;
  onChangeRequestView: (view: RequestView) => void;
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
    <main class="tb-popup text-zinc-950">
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
        )}

        {summary?.hostRowsTruncated && (
          <p class="mt-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
            Showing a limited host list. {summary.omittedRequestCount} requests
            are omitted below; totals above are complete.
          </p>
        )}

        {hasSystemIssue && (
          <SystemNotice
            backgroundStatus={backgroundStatus}
            settingsStatus={settingsStatus}
          />
        )}

        <Diagnostics
          diagnostics={diagnostics}
          hasIncompleteRequestHistory={
            summary?.activeRequestEvidenceTruncated ?? false
          }
        />
      </section>
    </main>
  );
}

function Diagnostics({
  diagnostics,
  hasIncompleteRequestHistory,
}: {
  diagnostics: HealthCheckResponse | null;
  hasIncompleteRequestHistory: boolean;
}) {
  if (!diagnostics && !hasIncompleteRequestHistory) {
    return null;
  }

  const provenance = diagnostics?.easyPrivacy.provenance;
  return (
    <details class="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-600">
      <summary class="cursor-pointer font-medium text-zinc-700">
        Diagnostics
      </summary>
      <dl class="mt-2 grid gap-1.5">
        {diagnostics && (
          <>
            <DiagnosticRow
              label="EasyPrivacy"
              value={
                diagnostics.easyPrivacy.matchingEnabled
                  ? "enabled for this build"
                  : "disabled (default)"
              }
            />
            <DiagnosticRow
              label="Engine"
              value={`${diagnostics.easyPrivacy.engineHealth}${
                diagnostics.easyPrivacy.degradedReason
                  ? ` (${diagnostics.easyPrivacy.degradedReason})`
                  : ""
              }`}
            />
            <DiagnosticRow
              label="Site access"
              value={
                diagnostics.easyPrivacy.hostPermissionGranted
                  ? "granted"
                  : "missing"
              }
            />
            <DiagnosticRow
              label="Settings"
              value={`${diagnostics.settings.health}${
                diagnostics.settings.degradedReason
                  ? ` (${diagnostics.settings.degradedReason})`
                  : ""
              }`}
            />
          </>
        )}
        {provenance && (
          <DiagnosticRow
            label="List"
            value={`${provenance.upstreamVersion}; artifact ${provenance.artifactSha256.slice(0, 12)}; engine ${provenance.ghosteryPackageVersion}`}
          />
        )}
        {hasIncompleteRequestHistory && (
          <DiagnosticRow
            label="Request history"
            value="Some older request histories are incomplete. Blocking and totals are unaffected."
          />
        )}
      </dl>
    </details>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt class="font-medium text-zinc-500">{label}</dt>
      <dd class="m-0 min-w-0 break-words text-zinc-700">{value}</dd>
    </div>
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

  return (
    <section class="tb-metric-panel mt-5" aria-label="Protection summary">
      <p class="tb-metric-value">{requestCounts.blocked}</p>
      <p class="tb-metric-label">
        {requestCounts.blocked === 1 ? "Request blocked" : "Requests blocked"}
      </p>

      <dl class="tb-stat-grid" aria-label="Observed request totals">
        <Stat label="Allowed" value={requestCounts.allowed} />
        <Stat label="Restricted" value={requestCounts.restricted} />
        <Stat label="Total" value={requestCounts.total} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
          label="Pause for this tab"
          tone="primary"
          onClick={() => void onSetPause("once")}
        />
      )}
      <PauseButton
        isDisabled={isDisabled}
        label="Always pause site"
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
  settingsStatus,
}: {
  backgroundStatus: BackgroundStatus;
  settingsStatus: SettingsStatus;
}) {
  return (
    <p class="mt-4 border-l-2 border-[#d9534f] bg-[#fff6f4] px-3 py-2 text-xs leading-snug text-[#7a2d2a]">
      Protection is degraded. Background: {backgroundStatus}; settings:{" "}
      {settingsStatus}.
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
