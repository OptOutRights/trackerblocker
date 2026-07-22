import { describe, expect, it } from "vitest";

import {
  EnforcementLedger,
  canRestoreEnforcementEntry,
  recordCancellationDecision,
} from "./enforcementLedger";

describe("canRestoreEnforcementEntry", () => {
  it("requires the current native document id on an enforceable page", () => {
    expect(
      canRestoreEnforcementEntry({
        storedDocumentId: "document-a",
        currentDocumentId: "document-a",
        pageUrl: "https://publisher.test/article",
      }),
    ).toBe(true);
    expect(
      canRestoreEnforcementEntry({
        storedDocumentId: "document-a",
        currentDocumentId: "document-b",
        pageUrl: "https://publisher.test/article",
      }),
    ).toBe(false);
    expect(
      canRestoreEnforcementEntry({
        storedDocumentId: "document-a",
        currentDocumentId: null,
        pageUrl: "https://publisher.test/article",
      }),
    ).toBe(false);
    expect(
      canRestoreEnforcementEntry({
        storedDocumentId: "document-a",
        currentDocumentId: "document-a",
        pageUrl: "about:preferences",
      }),
    ).toBe(false);
  });
});

describe("EnforcementLedger", () => {
  it("restores a count only for the same top-level document", () => {
    const ledger = new EnforcementLedger();
    ledger.restore(
      true,
      new Map([[12, { documentId: "document-a", blockedCount: 4 }]]),
    );

    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "available",
      blockedCount: 4,
    });
    expect(ledger.getCount(12, "document-b")).toEqual({
      status: "unavailable",
      blockedCount: null,
    });
  });

  it("increments only an initialized matching document", () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");

    expect(ledger.recordBlock(12, "document-a")).toBe(1);
    expect(ledger.recordBlock(12, "document-a")).toBe(2);
    expect(ledger.recordBlock(12, "document-b")).toBeNull();
    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "available",
      blockedCount: 2,
    });
  });

  it("does not claim zero before fresh state is initialized", () => {
    const ledger = new EnforcementLedger();
    ledger.restore(false, new Map());

    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "unavailable",
      blockedCount: null,
    });
    ledger.startDocument(12, "document-a");
    ledger.finishInitialization();
    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "available",
      blockedCount: 0,
    });
  });

  it("resets on a new document and removes closed tabs", () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");
    ledger.recordBlock(12, "document-a");
    ledger.startDocument(12, "document-b");

    expect(ledger.getCount(12, "document-b")).toEqual({
      status: "available",
      blockedCount: 0,
    });
    ledger.remove(12);
    expect(ledger.entries()).toEqual(new Map());
  });

  it("keeps cancellation effective when count persistence fails", async () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");

    await expect(
      recordCancellationDecision({
        ledger,
        tabId: 12,
        documentId: "document-a",
        countingAvailable: true,
        persist: async () => false,
      }),
    ).resolves.toEqual({
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    });
    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "unavailable",
      blockedCount: null,
    });
  });

  it("records a successful cancellation exactly once", async () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");

    await expect(
      recordCancellationDecision({
        ledger,
        tabId: 12,
        documentId: "document-a",
        countingAvailable: true,
        persist: async () => true,
      }),
    ).resolves.toEqual({
      cancel: true,
      count: { status: "available", blockedCount: 1 },
    });
  });

  it("keeps concurrent cancellations for the same document available", async () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");

    const first = recordCancellationDecision({
      ledger,
      tabId: 12,
      documentId: "document-a",
      countingAvailable: true,
      persist: async () => true,
    });
    const second = recordCancellationDecision({
      ledger,
      tabId: 12,
      documentId: "document-a",
      countingAvailable: true,
      persist: async () => true,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        cancel: true,
        count: { status: "available", blockedCount: 1 },
      },
      {
        cancel: true,
        count: { status: "available", blockedCount: 2 },
      },
    ]);
  });

  it("does not revive a count invalidated by a concurrent failed write", async () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");
    let writes = 0;

    await expect(
      recordCancellationDecision({
        ledger,
        tabId: 12,
        documentId: "document-a",
        countingAvailable: true,
        persist: async () => {
          writes += 1;
          if (writes === 1) {
            ledger.markUnavailable(12);
          }
          return true;
        },
      }),
    ).resolves.toEqual({
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    });
    expect(writes).toBe(1);
    expect(ledger.getCount(12, "document-a")).toEqual({
      status: "unavailable",
      blockedCount: null,
    });
  });

  it("does not invalidate a newer document after an older write", async () => {
    const ledger = new EnforcementLedger();
    ledger.restore(true, new Map());
    ledger.startDocument(12, "document-a");

    await expect(
      recordCancellationDecision({
        ledger,
        tabId: 12,
        documentId: "document-a",
        countingAvailable: true,
        persist: async () => {
          ledger.startDocument(12, "document-b");
          return true;
        },
      }),
    ).resolves.toEqual({
      cancel: true,
      count: { status: "unavailable", blockedCount: null },
    });
    expect(ledger.getCount(12, "document-b")).toEqual({
      status: "available",
      blockedCount: 0,
    });
  });
});
