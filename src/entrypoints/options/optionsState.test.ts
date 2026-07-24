import { describe, expect, it } from "vitest";

import {
  INITIAL_OPTIONS_STATE,
  areSettingsMutationControlsDisabled,
  canStartSettingsMutation,
  getOptionsSettingsView,
  hasSavedRules,
  optionsStateReducer,
  type OptionsState,
  type SettingsMutation,
} from "./optionsState";
import {
  SETTINGS_SCHEMA_VERSION,
  type TrackerBlockerSettings,
} from "../../storage/settings";

const REMOVE_PAUSE: SettingsMutation = {
  kind: "remove-site-pause",
  site: "paused.test",
};
const RESET_RULES: SettingsMutation = { kind: "reset-saved-rules" };

describe("options settings state", () => {
  it("starts loading without a settings snapshot", () => {
    expect(INITIAL_OPTIONS_STATE).toEqual({
      loadStatus: "loading",
      settings: null,
      mutation: { status: "idle" },
      resetConfirmation: "closed",
    });
    expect(areSettingsMutationControlsDisabled(INITIAL_OPTIONS_STATE)).toBe(
      true,
    );
  });

  it("stores an empty settings snapshot only after a successful load", () => {
    const settings = createSettings();
    const state = loadSettings(settings);

    expect(state.loadStatus).toBe("ready");
    expect(state.settings).toBe(settings);
    expect(getOptionsSettingsView(settings)).toEqual({
      pausedSites: [],
      siteAllows: [],
      domainOverrides: [],
    });
    expect(hasSavedRules(settings)).toBe(false);
  });

  it("represents initial failure without a false empty settings snapshot", () => {
    const state = optionsStateReducer(INITIAL_OPTIONS_STATE, {
      type: "load-failed",
    });

    expect(state.loadStatus).toBe("unavailable");
    expect(state.settings).toBeNull();
    expect(areSettingsMutationControlsDisabled(state)).toBe(true);
  });

  it("retries an unsuccessful initial load", () => {
    const unavailable = optionsStateReducer(INITIAL_OPTIONS_STATE, {
      type: "load-failed",
    });

    expect(
      optionsStateReducer(unavailable, { type: "load-started" }),
    ).toEqual(INITIAL_OPTIONS_STATE);
  });

  it("keeps a last-known-good snapshot usable if a later load fails", () => {
    const settings = createPopulatedSettings();
    const reloading = optionsStateReducer(loadSettings(settings), {
      type: "load-started",
    });
    const state = optionsStateReducer(reloading, { type: "load-failed" });

    expect(state.loadStatus).toBe("ready");
    expect(state.settings).toBe(settings);
  });

  it("sorts populated settings without shortening hostname values", () => {
    const longHostname =
      "a-very-long-tracker-hostname-segment.example.another-long-segment.test";
    const settings = createSettings({
      pausedSites: {
        "z.test": true,
        "a.test": true,
      },
      siteAllows: {
        "z.test": {
          "b.test": true,
        },
        "a.test": {
          "z.test": true,
          [longHostname]: true,
        },
      },
      domainOverrides: {
        "z.test": "allow",
        "a.test": "block",
      },
    });

    expect(getOptionsSettingsView(settings)).toEqual({
      pausedSites: ["a.test", "z.test"],
      siteAllows: [
        { site: "a.test", domain: longHostname },
        { site: "a.test", domain: "z.test" },
        { site: "z.test", domain: "b.test" },
      ],
      domainOverrides: [
        ["a.test", "block"],
        ["z.test", "allow"],
      ],
    });
    expect(hasSavedRules(settings)).toBe(true);
  });

  it("starts one mutation and globally disables mutation controls", () => {
    const state = optionsStateReducer(loadSettings(createPopulatedSettings()), {
      type: "mutation-started",
      mutation: REMOVE_PAUSE,
    });

    expect(state.mutation).toEqual({
      status: "pending",
      mutation: REMOVE_PAUSE,
    });
    expect(areSettingsMutationControlsDisabled(state)).toBe(true);
  });

  it("safely rejects an overlapping mutation", () => {
    const pending = optionsStateReducer(loadSettings(createPopulatedSettings()), {
      type: "mutation-started",
      mutation: REMOVE_PAUSE,
    });

    expect(
      optionsStateReducer(pending, {
        type: "mutation-started",
        mutation: {
          kind: "reset-domain-override",
          domain: "override.test",
        },
      }),
    ).toBe(pending);
  });

  it("uses a successful mutation response as the new settings snapshot", () => {
    const pending = startMutation(REMOVE_PAUSE);
    const updated = createSettings({
      domainOverrides: { "override.test": "block" },
    });
    const state = optionsStateReducer(pending, {
      type: "mutation-succeeded",
      mutation: REMOVE_PAUSE,
      settings: updated,
      message: "Protection resumed.",
    });

    expect(state.settings).toBe(updated);
    expect(state.mutation).toEqual({
      status: "succeeded",
      mutation: REMOVE_PAUSE,
      message: "Protection resumed.",
    });
    expect(areSettingsMutationControlsDisabled(state)).toBe(false);
  });

  it("retains the last-known-good snapshot after mutation failure", () => {
    const pending = startMutation(REMOVE_PAUSE);
    const previousSettings = pending.settings;
    const state = optionsStateReducer(pending, {
      type: "mutation-failed",
      mutation: REMOVE_PAUSE,
      message: "Could not resume protection.",
    });

    expect(state.loadStatus).toBe("ready");
    expect(state.settings).toBe(previousSettings);
    expect(state.mutation.status).toBe("failed");
    expect(canStartSettingsMutation(state, REMOVE_PAUSE)).toBe(true);
  });

  it("opens and cancels reset confirmation without starting a mutation", () => {
    const opened = optionsStateReducer(loadSettings(createPopulatedSettings()), {
      type: "reset-confirmation-opened",
    });
    const cancelled = optionsStateReducer(opened, {
      type: "reset-confirmation-closed",
    });

    expect(opened.resetConfirmation).toBe("open");
    expect(opened.mutation.status).toBe("idle");
    expect(cancelled.resetConfirmation).toBe("closed");
    expect(cancelled.mutation.status).toBe("idle");
  });

  it("does not open reset confirmation when there are no saved rules", () => {
    const empty = loadSettings(createSettings());

    expect(
      optionsStateReducer(empty, { type: "reset-confirmation-opened" }),
    ).toBe(empty);
  });

  it("clears saved rules and closes confirmation after reset success", () => {
    const pending = startReset();
    const emptySettings = createSettings();
    const state = optionsStateReducer(pending, {
      type: "mutation-succeeded",
      mutation: RESET_RULES,
      settings: emptySettings,
      message: "Saved rules were reset.",
    });

    expect(state.settings).toBe(emptySettings);
    expect(state.settings && hasSavedRules(state.settings)).toBe(false);
    expect(state.resetConfirmation).toBe("closed");
    expect(state.mutation.status).toBe("succeeded");
  });

  it("retains settings and keeps reset retry available after failure", () => {
    const pending = startReset();
    const previousSettings = pending.settings;
    const state = optionsStateReducer(pending, {
      type: "mutation-failed",
      mutation: RESET_RULES,
      message: "Could not reset saved rules.",
    });

    expect(state.settings).toBe(previousSettings);
    expect(state.resetConfirmation).toBe("open");
    expect(state.mutation.status).toBe("failed");
    expect(canStartSettingsMutation(state, RESET_RULES)).toBe(true);
  });
});

function createSettings(
  overrides: Partial<TrackerBlockerSettings> = {},
): TrackerBlockerSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    pausedSites: {},
    domainOverrides: {},
    siteAllows: {},
    ...overrides,
  };
}

function createPopulatedSettings(): TrackerBlockerSettings {
  return createSettings({
    pausedSites: { "paused.test": true },
    domainOverrides: { "override.test": "block" },
    siteAllows: { "site.test": { "allowed.test": true } },
  });
}

function loadSettings(settings: TrackerBlockerSettings): OptionsState {
  return optionsStateReducer(INITIAL_OPTIONS_STATE, {
    type: "load-succeeded",
    settings,
  });
}

function startMutation(mutation: SettingsMutation): OptionsState {
  return optionsStateReducer(loadSettings(createPopulatedSettings()), {
    type: "mutation-started",
    mutation,
  });
}

function startReset(): OptionsState {
  const opened = optionsStateReducer(loadSettings(createPopulatedSettings()), {
    type: "reset-confirmation-opened",
  });

  return optionsStateReducer(opened, {
    type: "mutation-started",
    mutation: RESET_RULES,
  });
}
