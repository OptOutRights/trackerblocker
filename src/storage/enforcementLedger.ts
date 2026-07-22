import type { PersistedEnforcementLedgerEntry } from "./sessionState";
import { isEnforceablePageUrl } from "../shared/tabPageUrls";

export type EnforcementCountStatus =
  | { status: "available"; blockedCount: number }
  | { status: "unavailable"; blockedCount: null };

export interface CancellationLedgerResult {
  cancel: true;
  count: EnforcementCountStatus;
}

export function canRestoreEnforcementEntry({
  storedDocumentId,
  currentDocumentId,
  pageUrl,
}: {
  storedDocumentId: string;
  currentDocumentId: string | null;
  pageUrl: string | null;
}): boolean {
  return (
    currentDocumentId !== null &&
    currentDocumentId === storedDocumentId &&
    isEnforceablePageUrl(pageUrl)
  );
}

export async function recordCancellationDecision({
  ledger,
  tabId,
  documentId,
  countingAvailable,
  persist,
}: {
  ledger: EnforcementLedger;
  tabId: number;
  documentId: string | null;
  countingAvailable: boolean;
  persist: () => Promise<boolean>;
}): Promise<CancellationLedgerResult> {
  if (!countingAvailable || !documentId) {
    ledger.markUnavailable(tabId);
    await persist().catch(() => false);
    return {
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    };
  }

  const blockedCount = ledger.recordBlock(tabId, documentId);
  if (blockedCount === null) {
    await persist().catch(() => false);
    return {
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    };
  }

  const persisted = await persist().catch(() => false);
  if (!persisted) {
    if (ledger.markDocumentUnavailable(tabId, documentId)) {
      // Best-effort removal prevents an older persisted count from being
      // treated as current if storage recovers before the worker restarts.
      await persist().catch(() => false);
    }
    return {
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    };
  }

  const current = ledger.getCount(tabId, documentId);
  if (current.status !== "available") {
    return {
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    };
  }

  return {
    cancel: true,
    // Later cancellations may already be pending for this document, but this
    // result represents only the cancellation whose persistence just settled.
    count: { status: "available", blockedCount },
  };
}

export class EnforcementLedger {
  readonly #entries = new Map<number, PersistedEnforcementLedgerEntry>();
  readonly #unavailableTabs = new Set<number>();
  #initialized = false;

  get initialized(): boolean {
    return this.#initialized;
  }

  restore(
    initialized: boolean,
    entries: ReadonlyMap<number, PersistedEnforcementLedgerEntry>,
  ): void {
    this.#initialized = initialized;
    this.#entries.clear();
    this.#unavailableTabs.clear();

    for (const [tabId, entry] of entries) {
      this.#entries.set(tabId, { ...entry });
    }
  }

  finishInitialization(): void {
    this.#initialized = true;
  }

  startDocument(tabId: number, documentId: string): void {
    if (!documentId) {
      this.markUnavailable(tabId);
      return;
    }

    this.#entries.set(tabId, { documentId, blockedCount: 0 });
    this.#unavailableTabs.delete(tabId);
  }

  recordBlock(tabId: number, documentId: string): number | null {
    if (!this.#initialized || this.#unavailableTabs.has(tabId) || !documentId) {
      return null;
    }

    const current = this.#entries.get(tabId);
    if (!current || current.documentId !== documentId) {
      return null;
    }

    const blockedCount = current.blockedCount + 1;
    if (!Number.isSafeInteger(blockedCount)) {
      this.markDocumentUnavailable(tabId, documentId);
      return null;
    }

    this.#entries.set(tabId, { documentId, blockedCount });
    return blockedCount;
  }

  getCount(tabId: number, documentId: string): EnforcementCountStatus {
    if (!this.#initialized || this.#unavailableTabs.has(tabId) || !documentId) {
      return { status: "unavailable", blockedCount: null };
    }

    const current = this.#entries.get(tabId);
    return current?.documentId === documentId
      ? { status: "available", blockedCount: current.blockedCount }
      : { status: "unavailable", blockedCount: null };
  }

  markUnavailable(tabId: number): void {
    this.#entries.delete(tabId);
    this.#unavailableTabs.add(tabId);
  }

  markDocumentUnavailable(tabId: number, documentId: string): boolean {
    if (this.#entries.get(tabId)?.documentId !== documentId) {
      return false;
    }

    this.markUnavailable(tabId);
    return true;
  }

  remove(tabId: number): void {
    this.#entries.delete(tabId);
    this.#unavailableTabs.delete(tabId);
  }

  hasEntry(tabId: number): boolean {
    return this.#entries.has(tabId);
  }

  entries(): Map<number, PersistedEnforcementLedgerEntry> {
    return new Map(
      [...this.#entries].map(([tabId, entry]) => [tabId, { ...entry }]),
    );
  }
}
