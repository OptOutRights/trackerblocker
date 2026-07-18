import { browser } from "wxt/browser";

import type { DomainOverrideAction } from "../shared/requestDecisions";

export const SETTINGS_STORAGE_KEY = "trackerblocker:settings";
export const SETTINGS_SCHEMA_VERSION = 1;

export type SitePauseMode = "once" | "always" | null;
export type SitePauseStatus = "active" | "paused-once" | "paused-always";

export interface TrackerBlockerSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  pausedSites: Record<string, true>;
  domainOverrides: Record<string, DomainOverrideAction>;
}

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SettingsUpdate =
  | {
      type: "site-pause";
      site: string;
      paused: boolean;
    }
  | {
      type: "domain-override";
      domain: string;
      action: DomainOverrideAction | null;
    };

const DEFAULT_SETTINGS: TrackerBlockerSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  pausedSites: {},
  domainOverrides: {},
};

export async function readSettings(
  storageArea: SettingsStorageArea = browser.storage.local,
): Promise<TrackerBlockerSettings> {
  const stored = await storageArea.get(SETTINGS_STORAGE_KEY);

  return normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
}

export async function writeSettings(
  settings: TrackerBlockerSettings,
  storageArea: SettingsStorageArea = browser.storage.local,
): Promise<TrackerBlockerSettings> {
  const normalized = normalizeSettings(settings);
  await storageArea.set({
    [SETTINGS_STORAGE_KEY]: normalized,
  });

  return normalized;
}

export async function updateSettings(
  update: SettingsUpdate,
  storageArea: SettingsStorageArea = browser.storage.local,
): Promise<TrackerBlockerSettings> {
  const settings = await readSettings(storageArea);

  if (update.type === "site-pause") {
    const site = normalizeSettingsKey(update.site);

    if (site && update.paused) {
      settings.pausedSites[site] = true;
    } else if (site) {
      delete settings.pausedSites[site];
    }
  }

  if (update.type === "domain-override") {
    const domain = normalizeSettingsKey(update.domain);

    if (domain && update.action) {
      settings.domainOverrides[domain] = update.action;
    } else if (domain) {
      delete settings.domainOverrides[domain];
    }
  }

  return writeSettings(settings, storageArea);
}

export async function resetSettings(
  storageArea: SettingsStorageArea = browser.storage.local,
): Promise<TrackerBlockerSettings> {
  await storageArea.remove(SETTINGS_STORAGE_KEY);

  return cloneDefaultSettings();
}

export function normalizeSettings(value: unknown): TrackerBlockerSettings {
  if (!isPlainObject(value)) {
    return cloneDefaultSettings();
  }

  if (value.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    return migrateSettings(value);
  }

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    pausedSites: normalizePausedSites(value.pausedSites),
    domainOverrides: normalizeDomainOverrides(value.domainOverrides),
  };
}

export function normalizeSettingsKey(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function migrateSettings(value: Record<string, unknown>): TrackerBlockerSettings {
  if (value.schemaVersion === undefined) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      pausedSites: normalizePausedSites(value.pausedSites),
      domainOverrides: normalizeDomainOverrides(value.domainOverrides),
    };
  }

  return cloneDefaultSettings();
}

function normalizePausedSites(value: unknown): Record<string, true> {
  if (Array.isArray(value)) {
    return Object.fromEntries(
      value
        .filter((site): site is string => typeof site === "string")
        .map(normalizeSettingsKey)
        .filter(Boolean)
        .map((site) => [site, true] as const),
    );
  }

  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, isPaused]) => isPaused === true)
      .map(([site]) => normalizeSettingsKey(site))
      .filter(Boolean)
      .map((site) => [site, true] as const),
  );
}

function normalizeDomainOverrides(
  value: unknown,
): Record<string, DomainOverrideAction> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, DomainOverrideAction] =>
        entry[1] === "block" || entry[1] === "allow",
      )
      .map(([domain, action]) => [normalizeSettingsKey(domain), action] as const)
      .filter(([domain]) => Boolean(domain)),
  );
}

function cloneDefaultSettings(): TrackerBlockerSettings {
  return {
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    pausedSites: {},
    domainOverrides: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
