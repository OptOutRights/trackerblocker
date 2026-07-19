import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsRuntime,
  type SettingsRuntimeSnapshot,
} from "./settingsRuntime";
import type { TrackerBlockerSettings } from "./settings";

const SETTINGS: TrackerBlockerSettings = {
  schemaVersion: 1,
  pausedSites: { "paused.test": true },
  domainOverrides: { "allowed.test": "allow" },
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SettingsRuntime", () => {
  it("waits up to the startup limit and fails open without a snapshot", async () => {
    vi.useFakeTimers();
    const runtime = new SettingsRuntime(500);
    runtime.start(() => new Promise(() => undefined));
    const pending = runtime.waitForUsableSettings();

    await vi.advanceTimersByTimeAsync(499);
    expect(runtime.snapshot.health).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeNull();
    expect(runtime.snapshot).toEqual<SettingsRuntimeSnapshot>({
      health: "degraded",
      settings: null,
      degradedReason: "timeout",
    });
  });

  it("accepts a successful read before or after the startup timeout", async () => {
    vi.useFakeTimers();
    let resolveLoad: ((settings: TrackerBlockerSettings) => void) | undefined;
    const runtime = new SettingsRuntime(500);
    runtime.start(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    await vi.advanceTimersByTimeAsync(500);
    await expect(runtime.waitForUsableSettings()).resolves.toBeNull();

    resolveLoad?.(SETTINGS);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(runtime.snapshot).toEqual<SettingsRuntimeSnapshot>({
      health: "ready",
      settings: SETTINGS,
      degradedReason: null,
    });
    await expect(runtime.waitForUsableSettings()).resolves.toBe(SETTINGS);
  });

  it("retains last-known-good settings when storage becomes unavailable", async () => {
    const runtime = new SettingsRuntime();
    runtime.accept(SETTINGS);
    runtime.degrade("storage-unavailable");

    expect(runtime.snapshot).toEqual<SettingsRuntimeSnapshot>({
      health: "degraded",
      settings: SETTINGS,
      degradedReason: "storage-unavailable",
    });
    await expect(runtime.waitForUsableSettings()).resolves.toBe(SETTINGS);
  });

  it("does not retry storage reads while settings are healthy", async () => {
    let attempts = 0;
    const runtime = new SettingsRuntime();
    runtime.accept(SETTINGS);

    runtime.retry(async () => {
      attempts += 1;
      return SETTINGS;
    });
    await Promise.resolve();

    expect(attempts).toBe(0);
  });

  it("does not let an older read overwrite settings accepted from a change event", async () => {
    let resolveLoad: ((settings: TrackerBlockerSettings) => void) | undefined;
    const runtime = new SettingsRuntime();
    const changedSettings: TrackerBlockerSettings = {
      ...SETTINGS,
      pausedSites: { "changed.test": true },
    };
    runtime.start(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    runtime.accept(changedSettings);
    resolveLoad?.(SETTINGS);
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.snapshot.settings).toBe(changedSettings);
  });

  it("throttles retries and accepts a later successful read", async () => {
    let now = 0;
    let attempts = 0;
    const runtime = new SettingsRuntime(500, 1_000, () => now);
    runtime.start(async () => {
      attempts += 1;
      throw new Error("unavailable");
    });
    await Promise.resolve();
    await Promise.resolve();
    await runtime.waitForUsableSettings();
    await new Promise((resolve) => setTimeout(resolve, 0));

    runtime.retry(async () => SETTINGS);
    expect(attempts).toBe(1);

    now = 1_000;
    runtime.retry(async () => {
      attempts += 1;
      return SETTINGS;
    });
    await vi.waitFor(() => expect(attempts).toBe(2));
    expect(runtime.snapshot.settings).toBe(SETTINGS);
  });
});
