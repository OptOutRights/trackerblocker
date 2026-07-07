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
import { formatUrlHost } from "../../shared/domains";
import type {
  ObservedRequestRow,
  RequestRelationship,
} from "../../shared/requestObservation";

type BackgroundStatus = "checking" | "ready" | "unavailable";
type PopupSummary = GetTabRequestSummaryResponse | null;
type RequestFilter = "all" | RequestRelationship | "blocked";

function formatHostname(url?: string): string {
  return formatUrlHost(url) ?? "Unavailable";
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
  const [backgroundStatus, setBackgroundStatus] =
    useState<BackgroundStatus>("checking");
  const [summary, setSummary] = useState<PopupSummary>(null);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("all");

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

      setActiveHost(formatHostname(tabs[0]?.url));

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
      } catch {
        setBackgroundStatus("unavailable");
      }
    }

    loadPopupState().catch(() => {
      if (!isMounted) {
        return;
      }

      setActiveHost("Unavailable");
      setBackgroundStatus("unavailable");
    });

    const refreshTimer = window.setInterval(() => {
      loadPopupState().catch(() => {
        if (!isMounted) {
          return;
        }

        setBackgroundStatus("unavailable");
      });
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

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
            Passive
          </span>
        </div>

        <div class="mt-4 grid gap-2 text-sm">
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Current tab</span>
            <span class="truncate font-medium text-zinc-900">{activeHost}</span>
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
            filter="unknown"
            isActive={requestFilter === "unknown"}
            label="Unknown"
            onSelect={setRequestFilter}
            value={summary?.unknownCount ?? 0}
          />
          <SummaryStat
            filter="first-party"
            isActive={requestFilter === "first-party"}
            label="First"
            onSelect={setRequestFilter}
            value={summary?.firstPartyCount ?? 0}
          />
          <SummaryStat
            filter="blocked"
            isActive={requestFilter === "blocked"}
            label="Blocked"
            onSelect={setRequestFilter}
            value={summary?.blockedCount ?? 0}
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

        <RequestRows filter={requestFilter} rows={filteredRows} />

        <p class="mt-4 text-xs text-zinc-500">
          Background: {backgroundStatus}. All observed requests are allowed in
          this phase.
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
  filter,
  rows,
}: {
  filter: RequestFilter;
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
          <RequestRow key={row.id} row={row} />
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
    return [];
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
      case "blocked":
        return `${base} border-zinc-500 bg-zinc-200 shadow-sm`;
      case "first-party":
        return `${base} border-emerald-500 bg-emerald-100 shadow-sm`;
      case "all":
        return `${base} border-emerald-600 bg-emerald-50 shadow-sm`;
    }
  }

  return `${base} border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white`;
}

function RequestRow({ row }: { row: ObservedRequestRow }) {
  return (
    <article class="rounded-lg border border-zinc-200 bg-white px-3 py-2">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-zinc-950">
            {row.displayName}
          </p>
          <p class="mt-1 text-xs text-zinc-500">
            {formatRelationship(row.relationship)} -{" "}
            {row.requestTypes.join(", ")}
          </p>
        </div>
        <div class="shrink-0 text-right">
          <span class={relationshipBadgeClass(row.relationship)}>
            {row.requestCount}
          </span>
          <p class="mt-1 text-xs text-zinc-500">allowed</p>
        </div>
      </div>
    </article>
  );
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
