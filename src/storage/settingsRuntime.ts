import type { TrackerBlockerSettings } from "./settings";

export const SETTINGS_STARTUP_TIMEOUT_MS = 500;
export const SETTINGS_RETRY_COOLDOWN_MS = 1_000;

export type SettingsRuntimeHealth = "loading" | "ready" | "degraded";
export type SettingsRuntimeDegradedReason =
  | "timeout"
  | "storage-unavailable";

export interface SettingsRuntimeSnapshot {
  health: SettingsRuntimeHealth;
  settings: TrackerBlockerSettings | null;
  degradedReason: SettingsRuntimeDegradedReason | null;
}

export type LoadRuntimeSettings = () => Promise<TrackerBlockerSettings>;

export class SettingsRuntime {
  #snapshot: SettingsRuntimeSnapshot = {
    health: "loading",
    settings: null,
    degradedReason: null,
  };
  #started = false;
  #loadInFlight: Promise<void> | null = null;
  #loadGeneration = 0;
  #lastLoadStartedAt = Number.NEGATIVE_INFINITY;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #resolveStartup!: (settings: TrackerBlockerSettings | null) => void;
  readonly #startup = new Promise<TrackerBlockerSettings | null>((resolve) => {
    this.#resolveStartup = resolve;
  });
  #startupResolved = false;

  constructor(
    private readonly timeoutMs = SETTINGS_STARTUP_TIMEOUT_MS,
    private readonly retryCooldownMs = SETTINGS_RETRY_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get snapshot(): SettingsRuntimeSnapshot {
    return this.#snapshot;
  }

  start(loadSettings: LoadRuntimeSettings): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#startupTimer = setTimeout(() => {
      if (this.#snapshot.settings || this.#startupResolved) {
        return;
      }

      this.#snapshot = {
        health: "degraded",
        settings: null,
        degradedReason: "timeout",
      };
      this.#loadInFlight = null;
      this.#resolveStartupOnce(null);
    }, this.timeoutMs);
    this.#beginLoad(loadSettings);
  }

  waitForUsableSettings(): Promise<TrackerBlockerSettings | null> {
    return this.#snapshot.settings
      ? Promise.resolve(this.#snapshot.settings)
      : this.#startup;
  }

  retry(loadSettings: LoadRuntimeSettings): void {
    if (
      this.#snapshot.health === "ready" ||
      this.#loadInFlight ||
      this.now() - this.#lastLoadStartedAt < this.retryCooldownMs
    ) {
      return;
    }

    this.#beginLoad(loadSettings);
  }

  accept(settings: TrackerBlockerSettings): void {
    // A storage change or successful settings mutation is newer than any read
    // already in flight, so prevent that older read from overwriting it.
    this.#loadGeneration += 1;
    this.#loadInFlight = null;
    this.#applySettings(settings);
  }

  #applySettings(settings: TrackerBlockerSettings): void {
    this.#clearStartupTimer();
    this.#snapshot = {
      health: "ready",
      settings,
      degradedReason: null,
    };
    this.#resolveStartupOnce(settings);
  }

  degrade(reason: SettingsRuntimeDegradedReason): void {
    this.#clearStartupTimer();
    this.#snapshot = {
      health: "degraded",
      settings: this.#snapshot.settings,
      degradedReason: reason,
    };
    this.#resolveStartupOnce(this.#snapshot.settings);
  }

  #beginLoad(loadSettings: LoadRuntimeSettings): void {
    const generation = ++this.#loadGeneration;
    this.#lastLoadStartedAt = this.now();
    const load = Promise.resolve()
      .then(loadSettings)
      .then((settings) => {
        if (generation === this.#loadGeneration) {
          this.#applySettings(settings);
        }
      })
      .catch(() => {
        if (generation === this.#loadGeneration) {
          this.degrade("storage-unavailable");
        }
      })
      .finally(() => {
        if (this.#loadInFlight === load) {
          this.#loadInFlight = null;
        }
      });

    this.#loadInFlight = load;
  }

  #resolveStartupOnce(settings: TrackerBlockerSettings | null): void {
    if (this.#startupResolved) {
      return;
    }

    this.#startupResolved = true;
    this.#resolveStartup(settings);
  }

  #clearStartupTimer(): void {
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
  }
}
