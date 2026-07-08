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
import type {
  ObservedRequestRow,
  RequestRelationship,
} from "../../shared/requestObservation";

type BackgroundStatus = "checking" | "ready" | "unavailable";
type SettingsStatus = "ready" | "unavailable";
type PopupSummary = GetTabRequestSummaryResponse | null;
type RequestFilter =
  | "all"
  | RequestRelationship
  | "blocked"
  | "allowed";

function normalizePopupKey(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

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
  const [backgroundStatus, setBackgroundStatus] =
    useState<BackgroundStatus>("checking");
  const [settingsStatus, setSettingsStatus] =
    useState<SettingsStatus>("ready");
  const [protectionPaused, setProtectionPaused] = useState(false);
  const [summary, setSummary] = useState<PopupSummary>(null);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");
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
      setActiveHost(tabSite ?? "Unavailable");
      setActiveSite(tabSite);

      try {
        const healthResponse = await browser.runtime.sendMessage({
          type: HEALTH_CHECK_MESSAGE,
        });

        setBackgroundStatus(
          isHealthCheckResponse(healthResponse) ? "ready" : "unavailable",
        );

        const activeTab = tabs[0];

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
          setProtectionPaused(
            tabSite
              ? settingsResponse.pausedSites[normalizePopupKey(tabSite)] === true
              : false,
          );
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

  async function updateSitePause(paused: boolean) {
    if (!activeSite) {
      return;
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: UPDATE_SITE_PAUSE_MESSAGE,
        site: activeSite,
        paused,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setSettingsStatus("unavailable");
        return;
      }

      setProtectionPaused(paused);
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

  const allRows = summary?.rows ?? [];
  const filteredRows = filterRows(allRows, requestFilter);

  return (
    <main class="w-[380px] bg-zinc-50 p-4 text-zinc-950">
      <section class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase text-emerald-700">
              TrackerBlocker
            </p>
            <h1 class="mt-1 text-xl font-semibold leading-tight">
              Request observation
            </h1>
          </div>
          <span class="rounded-full border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600">
            {protectionPaused ? "Paused" : "Active"}
          </span>
        </div>

        <div class="mt-4 grid gap-2 text-sm">
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Current tab</span>
            <span class="truncate font-medium text-zinc-900">{activeHost}</span>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Protection</span>
            <button
              class="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!activeSite || settingsStatus === "unavailable"}
              type="button"
              onClick={() => void updateSitePause(!protectionPaused)}
            >
              {protectionPaused ? "Resume" : "Pause"}
            </button>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Observed requests</span>
            <span class="font-medium text-zinc-900">
              {summary?.totalRequests ?? 0}
            </span>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          <SummaryStat
            filter="third-party"
            isActive={requestFilter === "third-party"}
            label="Third"
            onSelect={setRequestFilter}
            value={summary?.thirdPartyCount ?? 0}
          />
          <SummaryStat
            filter="blocked"
            isActive={requestFilter === "blocked"}
            label="Blocked"
            onSelect={setRequestFilter}
            value={summary?.blockedCount ?? 0}
          />
          <SummaryStat
            filter="allowed"
            isActive={requestFilter === "allowed"}
            label="Allowed"
            onSelect={setRequestFilter}
            value={summary?.allowedCount ?? 0}
          />
          <SummaryStat
            filter="unknown"
            isActive={requestFilter === "unknown"}
            label="Unknown"
            onSelect={setRequestFilter}
            value={summary?.unknownCount ?? 0}
          />
        </div>

        {requestFilter !== "all" && (
          <button
            class="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900"
            type="button"
            onClick={() => setRequestFilter("all")}
          >
            Showing {formatFilterLabel(requestFilter)} only. Show all.
          </button>
        )}

        <RequestRows
          expandedRowId={expandedRowId}
          filter={requestFilter}
          rows={filteredRows}
          onSetDomainOverride={updateDomainOverride}
          onToggleRow={(rowId) =>
            setExpandedRowId((current) => (current === rowId ? null : rowId))
          }
        />

        <p class="mt-4 text-xs text-zinc-500">
          Background: {backgroundStatus}. Decisions use local catalog rules;
          settings: {settingsStatus}.
        </p>
      </section>
    </main>
  );
}

function SummaryStat({
  filter,
  isActive,
  label,
  onSelect,
  value,
}: {
  filter: RequestFilter;
  isActive: boolean;
  label: string;
  onSelect: (filter: RequestFilter) => void;
  value: number;
}) {
  const isDisabled = value === 0;

  return (
    <button
      aria-pressed={isActive}
      class={summaryStatClass(filter, isActive, isDisabled)}
      disabled={isDisabled}
      type="button"
      onClick={() => onSelect(isActive ? "all" : filter)}
    >
      <div class="text-base font-semibold text-zinc-950">{value}</div>
      <div class="mt-1 text-zinc-500">{label}</div>
    </button>
  );
}

function RequestRows({
  expandedRowId,
  filter,
  onSetDomainOverride,
  onToggleRow,
  rows,
}: {
  expandedRowId: string | null;
  filter: RequestFilter;
  onSetDomainOverride: (
    domain: string,
    action: DomainOverrideAction | null,
  ) => Promise<void>;
  onToggleRow: (rowId: string) => void;
  rows: ObservedRequestRow[];
}) {
  if (rows.length === 0) {
    return (
      <div class="mt-5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
        {filter === "all"
          ? "No requests observed for this tab yet. Refresh the page to capture current requests."
          : `No ${formatFilterLabel(filter)} requests observed for this tab.`}
      </div>
    );
  }

  return (
    <div class="mt-5 max-h-[360px] overflow-y-auto">
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
  filter: RequestFilter,
): ObservedRequestRow[] {
  if (filter === "all") {
    return rows;
  }

  if (filter === "blocked") {
    return rows.filter((row) => row.status === "blocked");
  }

  if (filter === "allowed") {
    return rows.filter(
      (row) => row.status === "allowed" || row.status === "allowed-paused",
    );
  }

  if (filter === "unknown") {
    return rows.filter((row) => row.status === "unknown");
  }

  return rows.filter((row) => row.relationship === filter);
}

function formatFilterLabel(filter: RequestFilter): string {
  switch (filter) {
    case "third-party":
      return "third-party";
    case "first-party":
      return "first-party";
    case "unknown":
      return "unknown";
    case "blocked":
      return "blocked";
    case "allowed":
      return "allowed";
    case "all":
      return "all";
  }
}

function summaryStatClass(
  filter: RequestFilter,
  isActive: boolean,
  isDisabled: boolean,
): string {
  const base =
    "rounded-md border px-2 py-2 transition text-center focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1";

  if (isDisabled) {
    return `${base} cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-50`;
  }

  if (isActive) {
    switch (filter) {
      case "third-party":
        return `${base} border-amber-500 bg-amber-100 shadow-sm`;
      case "unknown":
        return `${base} border-zinc-500 bg-zinc-200 shadow-sm`;
      case "blocked":
        return `${base} border-red-500 bg-red-100 shadow-sm`;
      case "allowed":
        return `${base} border-emerald-500 bg-emerald-100 shadow-sm`;
      case "first-party":
        return `${base} border-emerald-500 bg-emerald-100 shadow-sm`;
      case "all":
        return `${base} border-emerald-600 bg-emerald-50 shadow-sm`;
    }
  }

  return `${base} border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white`;
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
    <article class="rounded-lg border border-zinc-200 bg-white px-3 py-2">
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
          <span class={relationshipBadgeClass(row.relationship)}>
            {row.requestCount}
          </span>
          <p class="mt-1 text-xs text-zinc-500">{formatStatus(row.status)}</p>
        </div>
      </button>

      {isExpanded && (
        <div class="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
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
            <div class="mt-3 grid grid-cols-3 overflow-hidden rounded-md border border-zinc-200">
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
          ? "bg-emerald-100 text-emerald-900"
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
    case "unknown":
      return "unknown";
    case "allowed-paused":
      return "paused";
  }
}

function relationshipBadgeClass(relationship: RequestRelationship): string {
  const base =
    "inline-flex min-w-8 justify-center rounded-full px-2 py-1 text-xs font-semibold";

  switch (relationship) {
    case "third-party":
      return `${base} bg-amber-100 text-amber-900`;
    case "unknown":
      return `${base} bg-zinc-200 text-zinc-800`;
    case "first-party":
      return `${base} bg-emerald-100 text-emerald-900`;
  }
}
