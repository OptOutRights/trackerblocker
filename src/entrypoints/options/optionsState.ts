import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type { TrackerBlockerSettings } from "../../storage/settings";

export type SettingsLoadStatus = "loading" | "ready" | "unavailable";
export type ResetConfirmationStatus = "closed" | "open";

export type SettingsMutation =
  | {
      kind: "remove-site-pause";
      site: string;
    }
  | {
      kind: "remove-site-allow";
      site: string;
      domain: string;
    }
  | {
      kind: "reset-domain-override";
      domain: string;
    }
  | {
      kind: "reset-saved-rules";
    };

export type SettingsMutationState =
  | {
      status: "idle";
    }
  | {
      status: "pending";
      mutation: SettingsMutation;
    }
  | {
      status: "failed";
      mutation: SettingsMutation;
      message: string;
    }
  | {
      status: "succeeded";
      mutation: SettingsMutation;
      message: string;
    };

export interface OptionsState {
  loadStatus: SettingsLoadStatus;
  settings: TrackerBlockerSettings | null;
  mutation: SettingsMutationState;
  resetConfirmation: ResetConfirmationStatus;
}

export type OptionsStateAction =
  | {
      type: "load-started";
    }
  | {
      type: "load-succeeded";
      settings: TrackerBlockerSettings;
    }
  | {
      type: "load-failed";
    }
  | {
      type: "mutation-started";
      mutation: SettingsMutation;
    }
  | {
      type: "mutation-succeeded";
      mutation: SettingsMutation;
      settings: TrackerBlockerSettings;
      message: string;
    }
  | {
      type: "mutation-failed";
      mutation: SettingsMutation;
      message: string;
    }
  | {
      type: "reset-confirmation-opened";
    }
  | {
      type: "reset-confirmation-closed";
    };

export interface OptionsSettingsView {
  pausedSites: string[];
  siteAllows: Array<{
    site: string;
    domain: string;
  }>;
  domainOverrides: Array<[string, DomainOverrideAction]>;
}

const IDLE_MUTATION: SettingsMutationState = { status: "idle" };

export const INITIAL_OPTIONS_STATE: OptionsState = {
  loadStatus: "loading",
  settings: null,
  mutation: IDLE_MUTATION,
  resetConfirmation: "closed",
};

export function optionsStateReducer(
  state: OptionsState,
  action: OptionsStateAction,
): OptionsState {
  switch (action.type) {
    case "load-started":
      return {
        ...state,
        loadStatus: "loading",
        mutation: IDLE_MUTATION,
        resetConfirmation: "closed",
      };
    case "load-succeeded":
      return {
        loadStatus: "ready",
        settings: action.settings,
        mutation: IDLE_MUTATION,
        resetConfirmation: "closed",
      };
    case "load-failed":
      return state.settings
        ? {
            ...state,
            loadStatus: "ready",
          }
        : {
            ...state,
            loadStatus: "unavailable",
            mutation: IDLE_MUTATION,
            resetConfirmation: "closed",
          };
    case "mutation-started":
      return canStartSettingsMutation(state, action.mutation)
        ? {
            ...state,
            mutation: {
              status: "pending",
              mutation: action.mutation,
            },
          }
        : state;
    case "mutation-succeeded":
      if (!isPendingMutation(state, action.mutation)) {
        return state;
      }

      return {
        loadStatus: "ready",
        settings: action.settings,
        mutation: {
          status: "succeeded",
          mutation: action.mutation,
          message: action.message,
        },
        resetConfirmation:
          action.mutation.kind === "reset-saved-rules"
            ? "closed"
            : state.resetConfirmation,
      };
    case "mutation-failed":
      if (!isPendingMutation(state, action.mutation)) {
        return state;
      }

      return {
        ...state,
        mutation: {
          status: "failed",
          mutation: action.mutation,
          message: action.message,
        },
      };
    case "reset-confirmation-opened":
      return canOpenResetConfirmation(state)
        ? {
            ...state,
            mutation: IDLE_MUTATION,
            resetConfirmation: "open",
          }
        : state;
    case "reset-confirmation-closed":
      return state.mutation.status === "pending"
        ? state
        : {
            ...state,
            mutation: IDLE_MUTATION,
            resetConfirmation: "closed",
          };
  }
}

export function canStartSettingsMutation(
  state: OptionsState,
  mutation: SettingsMutation,
): boolean {
  if (
    state.loadStatus !== "ready" ||
    !state.settings ||
    state.mutation.status === "pending"
  ) {
    return false;
  }

  return (
    mutation.kind !== "reset-saved-rules" ||
    (state.resetConfirmation === "open" && hasSavedRules(state.settings))
  );
}

export function areSettingsMutationControlsDisabled(
  state: OptionsState,
): boolean {
  return (
    state.loadStatus !== "ready" ||
    !state.settings ||
    state.mutation.status === "pending"
  );
}

export function canOpenResetConfirmation(state: OptionsState): boolean {
  return (
    !areSettingsMutationControlsDisabled(state) &&
    state.settings !== null &&
    hasSavedRules(state.settings)
  );
}

export function hasSavedRules(settings: TrackerBlockerSettings): boolean {
  return (
    Object.keys(settings.pausedSites).length > 0 ||
    Object.keys(settings.domainOverrides).length > 0 ||
    Object.values(settings.siteAllows).some(
      (domains) => Object.keys(domains).length > 0,
    )
  );
}

export function getOptionsSettingsView(
  settings: TrackerBlockerSettings,
): OptionsSettingsView {
  return {
    pausedSites: Object.keys(settings.pausedSites).sort(compareSettingsKeys),
    siteAllows: Object.entries(settings.siteAllows)
      .flatMap(([site, domains]) =>
        Object.keys(domains).map((domain) => ({ site, domain })),
      )
      .sort(
        (left, right) =>
          compareSettingsKeys(left.site, right.site) ||
          compareSettingsKeys(left.domain, right.domain),
      ),
    domainOverrides: Object.entries(settings.domainOverrides).sort(
      ([left], [right]) => compareSettingsKeys(left, right),
    ),
  };
}

export function isSameSettingsMutation(
  left: SettingsMutation,
  right: SettingsMutation,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "remove-site-pause":
      return right.kind === left.kind && left.site === right.site;
    case "remove-site-allow":
      return (
        right.kind === left.kind &&
        left.site === right.site &&
        left.domain === right.domain
      );
    case "reset-domain-override":
      return right.kind === left.kind && left.domain === right.domain;
    case "reset-saved-rules":
      return true;
  }
}

function isPendingMutation(
  state: OptionsState,
  mutation: SettingsMutation,
): boolean {
  return (
    state.mutation.status === "pending" &&
    isSameSettingsMutation(state.mutation.mutation, mutation)
  );
}

function compareSettingsKeys(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
