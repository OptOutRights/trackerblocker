import { browser } from "wxt/browser";

import { normalizeSettingsKey } from "./settings";

export const SESSION_STATE_STORAGE_KEY = "trackerblocker:session-state";
export const SESSION_STATE_SCHEMA_VERSION = 3;
export const SESSION_STATE_STARTUP_TIMEOUT_MS = 500;

export interface PersistedEnforcementLedgerEntry {
  documentId: string;
  blockedCount: number;
}

export interface TrackerBlockerSessionState {
  schemaVersion: typeof SESSION_STATE_SCHEMA_VERSION;
  temporarySitePauses: Record<string, string>;
  enforcementLedgerInitialized: boolean;
  enforcementLedger: Record<string, PersistedEnforcementLedgerEntry>;
}

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const DEFAULT_SESSION_STATE: TrackerBlockerSessionState = {
  schemaVersion: SESSION_STATE_SCHEMA_VERSION,
  temporarySitePauses: {},
  enforcementLedgerInitialized: false,
  enforcementLedger: {},
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
  if (isLegacySessionState(value)) {
    return {
      schemaVersion: SESSION_STATE_SCHEMA_VERSION,
      temporarySitePauses: normalizeTemporarySitePauses(
        value.temporarySitePauses,
      ),
      // Older schemas either did not retain counts or used an extension-owned
      // token that cannot be verified against Firefox's current document.
      enforcementLedgerInitialized: true,
      enforcementLedger: {},
    };
  }

  if (
    !isPlainObject(value) ||
    value.schemaVersion !== SESSION_STATE_SCHEMA_VERSION ||
    !isPlainObject(value.temporarySitePauses) ||
    typeof value.enforcementLedgerInitialized !== "boolean" ||
    !isPlainObject(value.enforcementLedger)
  ) {
    return value === undefined
      ? cloneDefaultSessionState()
      : createUnavailableSessionState();
  }

  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    temporarySitePauses: normalizeTemporarySitePauses(
      value.temporarySitePauses,
    ),
    enforcementLedgerInitialized: value.enforcementLedgerInitialized,
    enforcementLedger: normalizeEnforcementLedger(value.enforcementLedger),
  };
}

export function sessionStateFromPauses(
  pauses: ReadonlyMap<number, string>,
): TrackerBlockerSessionState {
  return sessionStateFromRuntime(pauses, false, new Map());
}

export function sessionStateFromRuntime(
  pauses: ReadonlyMap<number, string>,
  enforcementLedgerInitialized: boolean,
  enforcementLedger: ReadonlyMap<number, PersistedEnforcementLedgerEntry>,
): TrackerBlockerSessionState {
  return normalizeSessionState({
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    temporarySitePauses: Object.fromEntries(
      [...pauses.entries()].map(([tabId, site]) => [String(tabId), site]),
    ),
    enforcementLedgerInitialized,
    enforcementLedger: Object.fromEntries(
      [...enforcementLedger.entries()].map(([tabId, entry]) => [
        String(tabId),
        entry,
      ]),
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

export function enforcementLedgerFromSessionState(
  state: TrackerBlockerSessionState,
): Map<number, PersistedEnforcementLedgerEntry> {
  return new Map(
    Object.entries(state.enforcementLedger).map(([tabId, entry]) => [
      Number(tabId),
      entry,
    ]),
  );
}

function normalizeTemporarySitePauses(
  value: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([tabId, site]) => {
      const numericTabId = Number(tabId);
      const normalizedSite =
        typeof site === "string" ? normalizeSettingsKey(site) : "";
      return isValidTabId(tabId, numericTabId) && normalizedSite
        ? [[tabId, normalizedSite] as const]
        : [];
    }),
  );
}

function normalizeEnforcementLedger(
  value: Record<string, unknown>,
): Record<string, PersistedEnforcementLedgerEntry> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([tabId, entry]) => {
      const numericTabId = Number(tabId);
      if (
        !isValidTabId(tabId, numericTabId) ||
        !isPlainObject(entry) ||
        typeof entry.documentId !== "string" ||
        entry.documentId.trim() === "" ||
        !Number.isSafeInteger(entry.blockedCount) ||
        (entry.blockedCount as number) < 0
      ) {
        return [];
      }

      return [
        [
          tabId,
          {
            documentId: entry.documentId,
            blockedCount: entry.blockedCount as number,
          },
        ] as const,
      ];
    }),
  );
}

function isValidTabId(tabId: string, numericTabId: number): boolean {
  return (
    /^\d+$/.test(tabId) &&
    Number.isSafeInteger(numericTabId) &&
    numericTabId >= 0
  );
}

function isLegacySessionState(
  value: unknown,
): value is {
  schemaVersion: 1 | 2;
  temporarySitePauses: Record<string, unknown>;
} {
  return (
    isPlainObject(value) &&
    (value.schemaVersion === 1 || value.schemaVersion === 2) &&
    isPlainObject(value.temporarySitePauses)
  );
}

function createUnavailableSessionState(): TrackerBlockerSessionState {
  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    temporarySitePauses: {},
    enforcementLedgerInitialized: true,
    enforcementLedger: {},
  };
}

function cloneDefaultSessionState(): TrackerBlockerSessionState {
  return {
    schemaVersion: DEFAULT_SESSION_STATE.schemaVersion,
    temporarySitePauses: {},
    enforcementLedgerInitialized:
      DEFAULT_SESSION_STATE.enforcementLedgerInitialized,
    enforcementLedger: {},
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
