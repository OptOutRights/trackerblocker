import { describe, expect, it } from "vitest";

import { formatUrlHost } from "../shared/domains";
import {
  normalizeSettings,
  normalizeSettingsKey,
  readSettings,
  resetSettings,
  SETTINGS_STORAGE_KEY,
  SettingsMutationQueue,
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
  it("accepts only exact hostnames as settings keys", () => {
    expect(normalizeSettingsKey(" Tracker.Test. ")).toBe("tracker.test");
    expect(normalizeSettingsKey("tracker.test/path")).toBe("");
    expect(normalizeSettingsKey("user@tracker.test")).toBe("");
    expect(normalizeSettingsKey("tracker.test:443")).toBe("");
    expect(normalizeSettingsKey("bad_domain")).toBe("");
  });

  it("uses the same unbracketed canonical form for IPv6 settings keys", () => {
    expect(normalizeSettingsKey("::1")).toBe("::1");
    expect(normalizeSettingsKey("[::1]")).toBe("::1");
    expect(normalizeSettingsKey("2001:0DB8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeSettingsKey("tracker.test:443")).toBe("");
    expect(normalizeSettingsKey("not:ipv6")).toBe("");
    expect(normalizeSettingsKey(formatUrlHost("https://[::1]/") ?? "")).toBe(
      "::1",
    );
  });
  it("returns defaults for missing or malformed values", () => {
    expect(normalizeSettings(undefined)).toEqual({
      schemaVersion: 2,
      pausedSites: {},
      domainOverrides: {},
      siteAllows: {},
    });
    expect(normalizeSettings([])).toEqual({
      schemaVersion: 2,
      pausedSites: {},
      domainOverrides: {},
      siteAllows: {},
    });
  });

  it("normalizes version 2 settings", () => {
    expect(
      normalizeSettings({
        schemaVersion: 2,
        pausedSites: {
          " Example.COM. ": true,
          "disabled.example": false,
        },
        domainOverrides: {
          " TRACKER.Test. ": "block",
          "bad.example": "maybe",
        },
        siteAllows: {
          " Publisher.Test. ": {
            " TRACKER.Test. ": true,
            "bad_domain": true,
            "disabled.test": false,
          },
          "bad_site": { "tracker.test": true },
        },
      }),
    ).toEqual({
      schemaVersion: 2,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "tracker.test": "block",
      },
      siteAllows: {
        "publisher.test": {
          "tracker.test": true,
        },
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
      schemaVersion: 2,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "analytics.test": "allow",
      },
      siteAllows: {},
    });
  });

  it("migrates version 1 settings without changing existing controls", () => {
    expect(
      normalizeSettings({
        schemaVersion: 1,
        pausedSites: { "example.com": true },
        domainOverrides: { "tracker.test": "allow" },
      }),
    ).toEqual({
      schemaVersion: 2,
      pausedSites: { "example.com": true },
      domainOverrides: { "tracker.test": "allow" },
      siteAllows: {},
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
      schemaVersion: 2,
      pausedSites: {},
      domainOverrides: {},
      siteAllows: {},
    });
  });
});

describe("settings storage accessors", () => {
  it("reads defaults when storage is empty", async () => {
    await expect(readSettings(new MemoryStorageArea())).resolves.toEqual({
      schemaVersion: 2,
      pausedSites: {},
      domainOverrides: {},
      siteAllows: {},
    });
  });

  it("writes normalized settings", async () => {
    const storage = new MemoryStorageArea();

    await writeSettings(
      {
        schemaVersion: 2,
        pausedSites: {
          " Example.COM. ": true,
        },
        domainOverrides: {
          " Tracker.Test. ": "allow",
        },
        siteAllows: {},
      },
      storage,
    );

    expect(storage.items[SETTINGS_STORAGE_KEY]).toEqual({
      schemaVersion: 2,
      pausedSites: {
        "example.com": true,
      },
      domainOverrides: {
        "tracker.test": "allow",
      },
      siteAllows: {},
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

  it("updates and removes exact-site hostname allows", async () => {
    const storage = new MemoryStorageArea();

    await updateSettings(
      {
        type: "site-allow",
        site: " Publisher.Test. ",
        domain: " Tracker.Test. ",
        allowed: true,
      },
      storage,
    );
    await expect(readSettings(storage)).resolves.toMatchObject({
      siteAllows: {
        "publisher.test": { "tracker.test": true },
      },
    });

    await updateSettings(
      {
        type: "site-allow",
        site: "publisher.test",
        domain: "tracker.test",
        allowed: false,
      },
      storage,
    );
    await expect(readSettings(storage)).resolves.toMatchObject({
      siteAllows: {},
    });
  });

  it("serializes concurrent settings mutations", async () => {
    const storage = new MemoryStorageArea();
    const queue = new SettingsMutationQueue(storage);

    await Promise.all([
      queue.update({
        type: "site-pause",
        site: "publisher.test",
        paused: true,
      }),
      queue.update({
        type: "domain-override",
        domain: "tracker.test",
        action: "block",
      }),
      queue.update({
        type: "site-allow",
        site: "publisher.test",
        domain: "mixed.test",
        allowed: true,
      }),
    ]);

    await expect(readSettings(storage)).resolves.toMatchObject({
      pausedSites: { "publisher.test": true },
      domainOverrides: { "tracker.test": "block" },
      siteAllows: {
        "publisher.test": { "mixed.test": true },
      },
    });
  });

  it("resets local settings", async () => {
    const storage = new MemoryStorageArea({
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: 2,
        pausedSites: {
          "example.com": true,
        },
        domainOverrides: {},
        siteAllows: {},
      },
    });

    await expect(resetSettings(storage)).resolves.toEqual({
      schemaVersion: 2,
      pausedSites: {},
      domainOverrides: {},
      siteAllows: {},
    });
    expect(storage.items).not.toHaveProperty(SETTINGS_STORAGE_KEY);
  });
});
