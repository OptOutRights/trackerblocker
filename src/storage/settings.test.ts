import { describe, expect, it } from "vitest";

import {
  normalizeSettings,
  readSettings,
  resetSettings,
  SETTINGS_STORAGE_KEY,
  updateSettings,
  writeSettings,
  type SettingsStorageArea,
} from "./settings";

class MemoryStorageArea implements SettingsStorageArea {
  items: Record<string, unknown>;

  constructor(items: Record<string, unknown> = {}) {
    this.items = items;
  }

  async get(key: string): Promise<Record<string, unknown>> {
    return {
      [key]: this.items[key],
    };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.items = {
      ...this.items,
      ...items,
    };
  }

  async remove(key: string): Promise<void> {
    delete this.items[key];
  }
}

describe("normalizeSettings", () => {
  it("returns defaults for missing or malformed values", () => {
    expect(normalizeSettings(undefined)).toEqual({
      schemaVersion: 1,
      pausedSites: {},
      domainOverrides: {},
    });
    expect(normalizeSettings([])).toEqual({
      schemaVersion: 1,
      pausedSites: {},
      domainOverrides: {},
    });
  });

  it("normalizes version 1 settings", () => {
    expect(
      normalizeSettings({
        schemaVersion: 1,
        pausedSites: {
          " Example.COM. ": true,
          "disabled.example": false,
        },
        domainOverrides: {
          " TRACKER.Test. ": "block",
          "bad.example": "maybe",
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "tracker.test": "block",
      },
    });
  });

  it("migrates legacy unversioned settings without keeping bad values", () => {
    expect(
      normalizeSettings({
        pausedSites: [" Example.COM. ", 12],
        domainOverrides: {
          "analytics.test": "allow",
          "bad.test": "unknown",
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "analytics.test": "allow",
      },
    });
  });

  it("drops unknown future schema versions conservatively", () => {
    expect(
      normalizeSettings({
        schemaVersion: 99,
        pausedSites: {
          "example.com": true,
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      pausedSites: {},
      domainOverrides: {},
    });
  });
});

describe("settings storage accessors", () => {
  it("reads defaults when storage is empty", async () => {
    await expect(readSettings(new MemoryStorageArea())).resolves.toEqual({
      schemaVersion: 1,
      pausedSites: {},
      domainOverrides: {},
    });
  });

  it("writes normalized settings", async () => {
    const storage = new MemoryStorageArea();

    await writeSettings(
      {
        schemaVersion: 1,
        pausedSites: {
          " Example.COM. ": true,
        },
        domainOverrides: {
          " Tracker.Test. ": "allow",
        },
      },
      storage,
    );

    expect(storage.items[SETTINGS_STORAGE_KEY]).toEqual({
      schemaVersion: 1,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "tracker.test": "allow",
      },
    });
  });

  it("updates and removes site pauses", async () => {
    const storage = new MemoryStorageArea();

    await updateSettings(
      {
        type: "site-pause",
        site: " Example.COM. ",
        paused: true,
      },
      storage,
    );
    await updateSettings(
      {
        type: "site-pause",
        site: "example.com",
        paused: false,
      },
      storage,
    );

    await expect(readSettings(storage)).resolves.toMatchObject({
      pausedSites: {},
    });
  });

  it("updates and resets per-domain overrides", async () => {
    const storage = new MemoryStorageArea();

    await updateSettings(
      {
        type: "domain-override",
        domain: " Tracker.Test. ",
        action: "block",
      },
      storage,
    );
    await updateSettings(
      {
        type: "domain-override",
        domain: "tracker.test",
        action: null,
      },
      storage,
    );

    await expect(readSettings(storage)).resolves.toMatchObject({
      domainOverrides: {},
    });
  });

  it("resets local settings", async () => {
    const storage = new MemoryStorageArea({
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: 1,
        pausedSites: {
          "example.com": true,
        },
      },
    });

    await expect(resetSettings(storage)).resolves.toEqual({
      schemaVersion: 1,
      pausedSites: {},
      domainOverrides: {},
    });
    expect(storage.items).not.toHaveProperty(SETTINGS_STORAGE_KEY);
  });
});
