import { browser } from "wxt/browser";

import { normalizeSettingsKey } from "./settings";

export const SESSION_STATE_STORAGE_KEY = "trackerblocker:session-state";
export const SESSION_STATE_SCHEMA_VERSION = 1;
export const SESSION_STATE_STARTUP_TIMEOUT_MS = 500;

export interface TrackerBlockerSessionState {
  schemaVersion: typeof SESSION_STATE_SCHEMA_VERSION;
  temporarySitePauses: Record<string, string>;
}

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const DEFAULT_SESSION_STATE: TrackerBlockerSessionState = {
  schemaVersion: SESSION_STATE_SCHEMA_VERSION,
  temporarySitePauses: {},
};

export async function readSessionState(
  storageArea: SessionStorageArea = browser.storage.session,
): Promise<TrackerBlockerSessionState> {
  const stored = await storageArea.get(SESSION_STATE_STORAGE_KEY);
  return normalizeSessionState(stored[SESSION_STATE_STORAGE_KEY]);
}

export function readSessionStateWithin(
  timeoutMs: number = SESSION_STATE_STARTUP_TIMEOUT_MS,
  storageArea: SessionStorageArea = browser.storage.session,
): Promise<TrackerBlockerSessionState | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => finish(null), timeoutMs);
    const finish = (state: TrackerBlockerSessionState | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      resolve(state);
    };

    void readSessionState(storageArea).then(finish, () => finish(null));
  });
}

export async function writeSessionState(
  state: TrackerBlockerSessionState,
  storageArea: SessionStorageArea = browser.storage.session,
): Promise<TrackerBlockerSessionState> {
  const normalized = normalizeSessionState(state);
  await storageArea.set({ [SESSION_STATE_STORAGE_KEY]: normalized });
  return normalized;
}

export function normalizeSessionState(
  value: unknown,
): TrackerBlockerSessionState {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== SESSION_STATE_SCHEMA_VERSION ||
    !isPlainObject(value.temporarySitePauses)
  ) {
    return cloneDefaultSessionState();
  }

  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    temporarySitePauses: Object.fromEntries(
      Object.entries(value.temporarySitePauses).flatMap(([tabId, site]) => {
        const numericTabId = Number(tabId);
        const normalizedSite =
          typeof site === "string" ? normalizeSettingsKey(site) : "";
        return /^\d+$/.test(tabId) &&
          Number.isSafeInteger(numericTabId) &&
          numericTabId >= 0 &&
          normalizedSite
          ? [[tabId, normalizedSite] as const]
          : [];
      }),
    ),
  };
}

export function sessionStateFromPauses(
  pauses: ReadonlyMap<number, string>,
): TrackerBlockerSessionState {
  return normalizeSessionState({
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    temporarySitePauses: Object.fromEntries(
      [...pauses.entries()].map(([tabId, site]) => [String(tabId), site]),
    ),
  });
}

export function pausesFromSessionState(
  state: TrackerBlockerSessionState,
): Map<number, string> {
  return new Map(
    Object.entries(state.temporarySitePauses).map(([tabId, site]) => [
      Number(tabId),
      site,
    ]),
  );
}

function cloneDefaultSessionState(): TrackerBlockerSessionState {
  return {
    schemaVersion: DEFAULT_SESSION_STATE.schemaVersion,
    temporarySitePauses: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
