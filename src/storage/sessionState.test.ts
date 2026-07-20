import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_STATE_STORAGE_KEY,
  normalizeSessionState,
  pausesFromSessionState,
  readSessionState,
  readSessionStateWithin,
  sessionStateFromPauses,
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

describe("session pause state", () => {
  it("normalizes tab-scoped pauses and drops malformed values", () => {
    expect(
      normalizeSessionState({
        schemaVersion: 1,
        temporarySitePauses: {
          "12": " Publisher.Test. ",
          "-1": "bad.test",
          tab: "bad.test",
          "13": "bad_domain",
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      temporarySitePauses: { "12": "publisher.test" },
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

  it("fails closed to an empty session shape for unknown schemas", () => {
    expect(normalizeSessionState({ schemaVersion: 99 })).toEqual({
      schemaVersion: 1,
      temporarySitePauses: {},
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

  it("continues with protection active when session storage rejects", async () => {
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
        schemaVersion: 1,
        temporarySitePauses: { "12": "publisher.test" },
      },
    });
    await expect(pending).resolves.toEqual({
      schemaVersion: 1,
      temporarySitePauses: { "12": "publisher.test" },
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
        schemaVersion: 1,
        temporarySitePauses: { "12": "publisher.test" },
      },
    });
    await Promise.resolve();

    await expect(pending).resolves.toBeNull();
  });
});
