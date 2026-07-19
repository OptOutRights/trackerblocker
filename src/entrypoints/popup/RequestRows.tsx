import type { DomainOverrideAction } from "../../shared/requestDecisions";
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
            ? "No blocked hosts on this page yet."
            : "No hosts observed for this tab yet."}
        </p>
        <p class="mt-1 text-xs leading-snug text-zinc-500">
          {view === "blocked"
            ? "Open all hosts to inspect allowed or uncataloged activity."
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
    <article class={requestRowClass(row)}>
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
          <span class={statusBadgeClass(row)}>{row.requestCount}</span>
          <p class="mt-1 text-xs font-medium text-zinc-500">
            {formatActionSummary(row)}
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
            <DetailRow label="Lifecycle" value={formatLifecycle(row)} />
            <DetailRow label="Visibility" value={formatVisibilityNotes(row)} />
            <DetailRow label="Context" value={formatContextEvidence(row)} />
            <DetailRow label="Frames" value={formatFrameContexts(row)} />
            <DetailRow label="Path hints" value={formatPathHints(row)} />
            <DetailRow label="Redirects" value={formatRedirects(row)} />
            <DetailRow
              label="Rule source"
              value={formatRuleSources(row)}
            />
            <DetailRow label="Catalog basis" value={formatCatalogBasis(row)} />
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
    <div class="tb-detail-row">
      <dt class="font-medium text-zinc-500">{label}</dt>
      <dd class="min-w-0 text-zinc-800">{value}</dd>
    </div>
  );
}

function formatLifecycle(row: ObservedRequestRow): string {
  const parts = [
    `${row.lifecycle.started} started`,
    `${row.lifecycle.completed} completed`,
    `${row.lifecycle.redirected} redirects`,
    `${row.lifecycle.failed} failed`,
    `${row.lifecycle.blocked} blocked`,
  ];

  return parts.join(", ");
}

function formatVisibilityNotes(row: ObservedRequestRow): string {
  return [
    ...row.context.visibilityNotes.map(formatVisibilityNote),
    row.decisionEvidenceTruncated
      ? "matched rule samples are truncated"
      : null,
    row.redirectEvidenceTruncated ? "redirect samples are truncated" : null,
  ]
    .filter((note): note is string => Boolean(note))
    .join(", ");
}

function formatContextEvidence(row: ObservedRequestRow): string {
  const parts = [
    row.context.documentHosts.length
      ? `documents: ${row.context.documentHosts.join(", ")}`
      : null,
    row.context.initiatorHosts.length
      ? `initiators: ${row.context.initiatorHosts.join(", ")}`
      : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? parts.join("; ") : "No document or initiator host exposed.";
}

function formatFrameContexts(row: ObservedRequestRow): string {
  if (row.context.frameContexts.length === 0) {
    return "No frame context exposed.";
  }

  return row.context.frameContexts
    .map((context) => {
      const parent =
        context.parentFrameId === null ? "unknown parent" : `parent ${context.parentFrameId}`;
      const host = context.frameHost ?? context.documentHost ?? "unknown host";

      return `frame ${context.frameId} (${parent}, ${host})`;
    })
    .join("; ");
}

function formatPathHints(row: ObservedRequestRow): string {
  return row.context.pathHints.length
    ? row.context.pathHints.join(", ")
    : "No common collection path hints.";
}

function formatRedirects(row: ObservedRequestRow): string {
  if (row.redirectHops.length === 0) {
    return "No redirect hops captured.";
  }

  return row.redirectHops
    .map((hop) => {
      const status = hop.statusCode === null ? "redirect" : String(hop.statusCode);

      return `${hop.fromHost ?? "unknown"} -> ${hop.toHost ?? "unknown"} (${status})`;
    })
    .join("; ");
}

export function formatCatalogBasis(row: ObservedRequestRow): string {
  if (!row.catalogDefaultAction) {
    return row.relationship === "third-party"
      ? "Uncataloged third party; allowed by default."
      : "No catalog entry applies.";
  }

  return [
    `observed catalog evidence includes a packaged ${row.catalogDefaultAction} rule`,
    row.catalogRuleIds.length
      ? `rules: ${row.catalogRuleIds.join(", ")}`
      : null,
    row.catalogConfidence ? `${row.catalogConfidence} confidence` : null,
    row.catalogBreakageRisk ? `${row.catalogBreakageRisk} breakage risk` : null,
    row.catalogSource ? `source: ${row.catalogSource}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
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
  return row.currentOverride ?? "auto";
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

export function formatRuleSources(row: ObservedRequestRow): string {
  const labels: Array<[keyof ObservedRequestRow["sourceCounts"], string]> = [
    ["site-pause", "site pause"],
    ["user-block", "user block"],
    ["user-allow", "user allow"],
    ["settings-unavailable", "settings unavailable"],
    ["easyprivacy", "EasyPrivacy"],
    ["catalog", "catalog"],
    ["default", "default allow"],
  ];
  const observed = labels
    .filter(([source]) => row.sourceCounts[source] > 0)
    .map(([source, label]) => `${label}: ${row.sourceCounts[source]}`);

  return observed.length ? observed.join(", ") : "No decision source recorded";
}

function formatVisibilityNote(
  note: ObservedRequestRow["context"]["visibilityNotes"][number],
): string {
  switch (note) {
    case "visible-request":
      return "visible request";
    case "exit-beacon-may-be-missed":
      return "exit beacons can be missed";
    case "websocket-frames-not-classified":
      return "WebSocket frames are not classified";
    case "frame-ancestry-limited":
      return "frame ancestry is limited";
    case "browser-cache-may-hide-requests":
      return "browser cache may hide requests";
    case "dns-or-preconnect-not-visible":
      return "DNS/preconnect may not appear as requests";
    case "headers-not-inspected":
      return "headers are not inspected by default";
    case "evidence-truncated":
      return "context or active-request evidence is truncated";
    case "non-web-or-unclassifiable":
      return "non-web or unclassifiable";
  }
}

export function formatActionSummary(row: ObservedRequestRow): string {
  return [
    row.actionCounts.blocked > 0
      ? `${row.actionCounts.blocked} blocked`
      : null,
    row.actionCounts.restricted > 0
      ? `${row.actionCounts.restricted} restricted`
      : null,
    row.actionCounts.allowed > 0
      ? `${row.actionCounts.allowed} allowed`
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function requestRowClass(row: ObservedRequestRow): string {
  const base = "tb-request-row";

  if (row.isMixed) {
    return `${base} is-mixed`;
  }

  if (row.actionCounts.blocked > 0) {
    return `${base} is-blocked`;
  }

  if (row.actionCounts.restricted > 0) {
    return `${base} is-restricted`;
  }

  return `${base} is-allowed`;
}

function statusBadgeClass(row: ObservedRequestRow): string {
  const base =
    "inline-flex min-w-8 justify-center border px-2 py-1 text-xs font-semibold leading-none";

  if (row.isMixed) {
    return `${base} border-[#8ab7c9] bg-[#eef9fc] text-zinc-950`;
  }

  if (row.actionCounts.blocked > 0) {
    return `${base} border-[#5db7dd] bg-[#dff5ff] text-zinc-950`;
  }

  if (row.actionCounts.restricted > 0) {
    return `${base} border-[#d6c3a4] bg-[#fff8eb] text-[#6b4d21]`;
  }

  return `${base} border-zinc-200 bg-white text-zinc-700`;
}
