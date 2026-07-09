import type { DomainOverrideAction } from "../../shared/ruleDecisions";
import type {
  ObservedRequestRow,
  RequestRelationship,
} from "../../shared/requestObservation";
import type { RequestView } from "./PopupDashboard";

export function RequestRows({
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
    case "observability":
      return "likely observability";
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
    case "restricted":
      return "restricted";
    case "allowed-paused":
      return "paused";
  }
}

function requestRowClass(status: ObservedRequestRow["status"]): string {
  const base = "tb-request-row";

  switch (status) {
    case "blocked":
      return `${base} is-blocked`;
    case "restricted":
      return `${base} is-restricted`;
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
    case "restricted":
      return `${base} border-[#d6c3a4] bg-[#fff8eb] text-[#6b4d21]`;
    case "allowed":
      return `${base} border-zinc-200 bg-white text-zinc-700`;
    case "allowed-paused":
      return `${base} border-[#9fcbd6] bg-[#e8f8fb] text-zinc-800`;
  }
}
