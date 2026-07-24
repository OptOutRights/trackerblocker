import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_STATE_STORAGE_KEY,
  enforcementLedgerFromSessionState,
  normalizeSessionState,
  pausesFromSessionState,
  readSessionState,
  readSessionStateWithin,
  sessionStateFromPauses,
  sessionStateFromRuntime,
  writeSessionState,
  type SessionStorageArea,
} from "./sessionState";

afterEach(() => {
  vi.useRealTimers();
});

class MemorySessionStorage implements SessionStorageArea {
  items: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.items[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.items = { ...this.items, ...items };
  }
}

describe("session state", () => {
  it("normalizes tab-scoped pauses and drops malformed values", () => {
    expect(
      normalizeSessionState({
        schemaVersion: 3,
        temporarySitePauses: {
          "12": " Publisher.Test. ",
          "-1": "bad.test",
          tab: "bad.test",
          "13": "bad_domain",
        },
        enforcementLedgerInitialized: true,
        enforcementLedger: {},
      }),
    ).toEqual({
      schemaVersion: 3,
      temporarySitePauses: { "12": "publisher.test" },
      enforcementLedgerInitialized: true,
      enforcementLedger: {},
    });
  });

  it("round-trips pauses through memory-only session storage", async () => {
    const storage = new MemorySessionStorage();
    const pauses = new Map([[12, "publisher.test"]]);
    const written = await writeSessionState(
      sessionStateFromPauses(pauses),
      storage,
    );

    expect(storage.items[SESSION_STATE_STORAGE_KEY]).toEqual(written);
    expect(pausesFromSessionState(await readSessionState(storage))).toEqual(
      pauses,
    );
  });

  it("fails closed to unavailable counts for unknown schemas", () => {
    expect(normalizeSessionState({ schemaVersion: 99 })).toEqual({
      schemaVersion: 3,
      temporarySitePauses: {},
      enforcementLedgerInitialized: true,
      enforcementLedger: {},
    });
  });

  it("migrates legacy pauses without trusting extension-owned document tokens", () => {
    expect(
      normalizeSessionState({
        schemaVersion: 1,
        temporarySitePauses: { "12": "publisher.test" },
      }),
    ).toEqual({
      schemaVersion: 3,
      temporarySitePauses: { "12": "publisher.test" },
      enforcementLedgerInitialized: true,
      enforcementLedger: {},
    });

    expect(
      normalizeSessionState({
        schemaVersion: 2,
        temporarySitePauses: { "13": "example.test" },
        enforcementLedgerInitialized: true,
        enforcementLedger: {
          "13": { documentToken: "unverifiable-token", blockedCount: 4 },
        },
      }),
    ).toEqual({
      schemaVersion: 3,
      temporarySitePauses: { "13": "example.test" },
      enforcementLedgerInitialized: true,
      enforcementLedger: {},
    });
  });

  it("retains only opaque document ids and valid blocked counts", () => {
    const state = sessionStateFromRuntime(
      new Map(),
      true,
      new Map([
        [12, { documentId: "document-12", blockedCount: 3 }],
        [13, { documentId: "document-13", blockedCount: 0 }],
      ]),
    );

    expect(enforcementLedgerFromSessionState(state)).toEqual(
      new Map([
        [12, { documentId: "document-12", blockedCount: 3 }],
        [13, { documentId: "document-13", blockedCount: 0 }],
      ]),
    );
    expect(Object.keys(state).sort()).toEqual([
      "enforcementLedger",
      "enforcementLedgerInitialized",
      "schemaVersion",
      "temporarySitePauses",
    ]);
  });

  it("drops malformed ledger entries", () => {
    const state = normalizeSessionState({
      schemaVersion: 3,
      temporarySitePauses: {},
      enforcementLedgerInitialized: true,
      enforcementLedger: {
        "12": { documentId: "document-12", blockedCount: 2 },
        "13": { documentId: "", blockedCount: 1 },
        "14": { documentId: "document-14", blockedCount: -1 },
        tab: { documentId: "document-tab", blockedCount: 1 },
      },
    });

    expect(state.enforcementLedger).toEqual({
      "12": { documentId: "document-12", blockedCount: 2 },
    });
  });

  it("bounds startup when session storage does not respond", async () => {
    vi.useFakeTimers();
    const storage: SessionStorageArea = {
      get: () => new Promise(() => undefined),
      set: async () => undefined,
    };
    const pending = readSessionStateWithin(500, storage);

    await vi.advanceTimersByTimeAsync(499);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it("reports session storage rejection to the runtime", async () => {
    const storage: SessionStorageArea = {
      get: async () => {
        throw new Error("session storage unavailable");
      },
      set: async () => undefined,
    };

    await expect(readSessionStateWithin(500, storage)).resolves.toBeNull();
  });

  it("restores session state only when storage wins the startup race", async () => {
    vi.useFakeTimers();
    let resolveRead:
      | ((items: Record<string, unknown>) => void)
      | undefined;
    const storage: SessionStorageArea = {
      get: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      set: async () => undefined,
    };
    const pending = readSessionStateWithin(500, storage);

    resolveRead?.({
      [SESSION_STATE_STORAGE_KEY]: {
        schemaVersion: 3,
        temporarySitePauses: { "12": "publisher.test" },
        enforcementLedgerInitialized: true,
        enforcementLedger: {
          "12": { documentId: "document-12", blockedCount: 3 },
        },
      },
    });
    await expect(pending).resolves.toEqual({
      schemaVersion: 3,
      temporarySitePauses: { "12": "publisher.test" },
      enforcementLedgerInitialized: true,
      enforcementLedger: {
        "12": { documentId: "document-12", blockedCount: 3 },
      },
    });
  });

  it("ignores a session read that resolves after the startup timeout", async () => {
    vi.useFakeTimers();
    let resolveRead:
      | ((items: Record<string, unknown>) => void)
      | undefined;
    const storage: SessionStorageArea = {
      get: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      set: async () => undefined,
    };
    const pending = readSessionStateWithin(500, storage);

    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
    resolveRead?.({
      [SESSION_STATE_STORAGE_KEY]: {
        schemaVersion: 3,
        temporarySitePauses: { "12": "publisher.test" },
        enforcementLedgerInitialized: true,
        enforcementLedger: {},
      },
    });
    await Promise.resolve();

    await expect(pending).resolves.toBeNull();
  });
});
