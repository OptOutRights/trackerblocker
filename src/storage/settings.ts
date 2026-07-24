import { browser } from "wxt/browser";

import type { DomainOverrideAction } from "../shared/requestDecisions";

export const SETTINGS_STORAGE_KEY = "trackerblocker:settings";
export const SETTINGS_SCHEMA_VERSION = 2;

export type SitePauseMode = "once" | "always" | null;
export type SitePauseStatus = "active" | "paused-once" | "paused-always";

export interface TrackerBlockerSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  pausedSites: Record<string, true>;
  domainOverrides: Record<string, DomainOverrideAction>;
  siteAllows: Record<string, Record<string, true>>;
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
    }
  | {
      type: "site-allow";
      site: string;
      domain: string;
      allowed: boolean;
    };

const DEFAULT_SETTINGS: TrackerBlockerSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  pausedSites: {},
  domainOverrides: {},
  siteAllows: {},
};

export class SettingsMutationQueue {
  #tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storageArea: SettingsStorageArea = browser.storage.local,
  ) {}

  update(update: SettingsUpdate): Promise<TrackerBlockerSettings> {
    return this.#enqueue(() => updateSettings(update, this.storageArea));
  }

  reset(): Promise<TrackerBlockerSettings> {
    return this.#enqueue(() => resetSettings(this.storageArea));
  }

  #enqueue(
    mutation: () => Promise<TrackerBlockerSettings>,
  ): Promise<TrackerBlockerSettings> {
    const result = this.#tail.then(mutation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

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

  if (update.type === "site-allow") {
    const site = normalizeSettingsKey(update.site);
    const domain = normalizeSettingsKey(update.domain);

    if (site && domain && update.allowed) {
      settings.siteAllows[site] = {
        ...settings.siteAllows[site],
        [domain]: true,
      };
    } else if (site && domain) {
      const siteAllows = { ...settings.siteAllows[site] };
      delete siteAllows[domain];

      if (Object.keys(siteAllows).length === 0) {
        delete settings.siteAllows[site];
      } else {
        settings.siteAllows[site] = siteAllows;
      }
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
    siteAllows: normalizeSiteAllows(value.siteAllows),
  };
}

export function normalizeSettingsKey(value: string): string {
  const candidate = value.trim().toLowerCase().replace(/\.+$/, "");

  if (!candidate || candidate.length > 253) {
    return "";
  }

  const ipv6Candidate =
    candidate.startsWith("[") && candidate.endsWith("]")
      ? candidate.slice(1, -1)
      : candidate;

  if (ipv6Candidate.includes(":")) {
    return normalizeIpv6SettingsKey(ipv6Candidate);
  }

  try {
    const parsed = new URL(`https://${candidate}/`);
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.+$/, "");
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      candidate !== hostname
    ) {
      return "";
    }
    const isDomainOrIpv4 = hostname
      .split(".")
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          /^[a-z0-9-]+$/.test(label) &&
          !label.startsWith("-") &&
          !label.endsWith("-"),
      );

    return isDomainOrIpv4 ? hostname : "";
  } catch {
    return "";
  }
}

function normalizeIpv6SettingsKey(candidate: string): string {
  try {
    const parsed = new URL(`https://[${candidate}]/`);
    const hostname = parsed.hostname.toLowerCase();

    if (
      !hostname.startsWith("[") ||
      !hostname.endsWith("]") ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return "";
    }

    return hostname.slice(1, -1);
  } catch {
    return "";
  }
}

function migrateSettings(value: Record<string, unknown>): TrackerBlockerSettings {
  if (value.schemaVersion === undefined || value.schemaVersion === 1) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      pausedSites: normalizePausedSites(value.pausedSites),
      domainOverrides: normalizeDomainOverrides(value.domainOverrides),
      siteAllows: {},
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

function normalizeSiteAllows(
  value: unknown,
): Record<string, Record<string, true>> {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([site, domains]) => {
      const normalizedSite = normalizeSettingsKey(site);

      if (!normalizedSite || !isPlainObject(domains)) {
        return [];
      }

      const normalizedDomains = Object.fromEntries(
        Object.entries(domains)
          .filter(([, allowed]) => allowed === true)
          .map(([domain]) => normalizeSettingsKey(domain))
          .filter(Boolean)
          .map((domain) => [domain, true] as const),
      );

      return Object.keys(normalizedDomains).length > 0
        ? [[normalizedSite, normalizedDomains] as const]
        : [];
    }),
  );
}

function cloneDefaultSettings(): TrackerBlockerSettings {
  return {
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    pausedSites: {},
    domainOverrides: {},
    siteAllows: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
