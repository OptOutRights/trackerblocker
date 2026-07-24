import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_MESSAGE,
  type HealthCheckResponse,
  isHealthCheckResponse,
} from "../../messaging/health";
import {
  GET_SETTINGS_MESSAGE,
  RESET_SETTINGS_MESSAGE,
  SETTINGS_RESPONSE,
  SET_DOMAIN_OVERRIDE_MESSAGE,
  SET_SITE_ALLOW_MESSAGE,
  UPDATE_SITE_PAUSE_MESSAGE,
  type SettingsMessage,
  isSettingsErrorResponse,
  isSettingsResponse,
} from "../../messaging/settings";
import type { DomainOverrideAction } from "../../shared/requestDecisions";
import {
  INITIAL_OPTIONS_STATE,
  areSettingsMutationControlsDisabled,
  canStartSettingsMutation,
  getOptionsSettingsView,
  hasSavedRules,
  optionsStateReducer,
  type SettingsMutation,
} from "./optionsState";

type DiagnosticsStatus = "loading" | "ready" | "unavailable";

const RESET_CONFIRMATION_ID = "reset-saved-rules-confirmation";

export function App() {
  const [state, dispatch] = useReducer(
    optionsStateReducer,
    INITIAL_OPTIONS_STATE,
  );
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [healthStatus, setHealthStatus] =
    useState<DiagnosticsStatus>("loading");
  const mutationInFlight = useRef(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const resetConfirmation = useRef<HTMLDivElement>(null);
  const mutationSuccess = useRef<HTMLParagraphElement>(null);
  const extensionVersion = browser.runtime.getManifest().version;

  async function loadSettings() {
    dispatch({ type: "load-started" });

    try {
      const response = await browser.runtime.sendMessage({
        type: GET_SETTINGS_MESSAGE,
      });

      if (
        isSettingsResponse(response) &&
        response.type === SETTINGS_RESPONSE
      ) {
        dispatch({
          type: "load-succeeded",
          settings: response,
        });
        return;
      }
    } catch {
      // The unavailable state below provides the retry path.
    }

    dispatch({ type: "load-failed" });
  }

  async function loadHealth() {
    setHealthStatus("loading");

    try {
      const response = await browser.runtime.sendMessage({
        type: HEALTH_CHECK_MESSAGE,
      });

      if (isHealthCheckResponse(response)) {
        setHealth(response);
        setHealthStatus("ready");
        return;
      }

      setHealth(null);
      setHealthStatus("unavailable");
    } catch {
      setHealth(null);
      setHealthStatus("unavailable");
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadHealth();
  }, []);

  useEffect(() => {
    if (state.resetConfirmation === "open") {
      resetConfirmation.current?.focus();
    }
  }, [state.resetConfirmation]);

  useEffect(() => {
    if (state.mutation.status === "succeeded") {
      mutationSuccess.current?.focus();
    }
  }, [state.mutation.status]);

  async function runSettingsMutation(
    mutation: SettingsMutation,
    message: SettingsMessage,
  ) {
    if (
      mutationInFlight.current ||
      !canStartSettingsMutation(state, mutation)
    ) {
      return;
    }

    mutationInFlight.current = true;
    dispatch({ type: "mutation-started", mutation });

    try {
      const response = await browser.runtime.sendMessage(message);

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        dispatch({
          type: "mutation-failed",
          mutation,
          message: getMutationFailureMessage(mutation),
        });
        return;
      }

      dispatch({
        type: "mutation-succeeded",
        mutation,
        settings: response,
        message: getMutationSuccessMessage(mutation),
      });
    } catch {
      dispatch({
        type: "mutation-failed",
        mutation,
        message: getMutationFailureMessage(mutation),
      });
    } finally {
      mutationInFlight.current = false;
    }
  }

  function closeResetConfirmation() {
    resetButton.current?.focus();
    dispatch({ type: "reset-confirmation-closed" });
  }

  const settingsView = state.settings
    ? getOptionsSettingsView(state.settings)
    : null;
  const mutationControlsDisabled =
    areSettingsMutationControlsDisabled(state);
  const resetDisabled =
    mutationControlsDisabled ||
    !state.settings ||
    !hasSavedRules(state.settings);
  const settingsBusy =
    state.loadStatus === "loading" || state.mutation.status === "pending";

  return (
    <main class="min-h-screen bg-white text-zinc-950">
      <div class="settings-shell mx-auto max-w-3xl px-4 py-6">
        <header class="mb-4 flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div>
            <h1 class="text-2xl font-semibold">Tracker Blocker Settings</h1>
            <p class="mt-1 text-sm text-zinc-600">by Opt Out Rights</p>
          </div>
          <button
            aria-controls={RESET_CONFIRMATION_ID}
            aria-expanded={state.resetConfirmation === "open"}
            class={destructiveButtonClass}
            disabled={resetDisabled}
            ref={resetButton}
            type="button"
            onClick={() =>
              dispatch({
                type:
                  state.resetConfirmation === "open"
                    ? "reset-confirmation-closed"
                    : "reset-confirmation-opened",
              })
            }
          >
            Reset saved rules…
          </button>
        </header>

        <p class="mb-6 max-w-2xl text-sm text-zinc-600">
          Create rules from the toolbar popup. Review or remove saved rules
          here.
        </p>

        <div
          aria-busy={settingsBusy}
          aria-label="Saved rules management"
          class="mb-6"
        >
          <div aria-atomic="true" aria-live="polite">
            {state.loadStatus === "loading" && (
              <p class="mb-4 rounded-md border border-[#cbd8ff] bg-[#f4f7ff] px-3 py-3 text-sm text-[#1644b8]">
                Loading saved rules…
              </p>
            )}

            {state.mutation.status === "pending" && (
              <p class="mb-4 rounded-md border border-[#cbd8ff] bg-[#f4f7ff] px-3 py-3 text-sm text-[#1644b8]">
                {getMutationPendingMessage(state.mutation.mutation)}
              </p>
            )}

            {state.mutation.status === "succeeded" && (
              <p
                class="settings-status mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800"
                ref={mutationSuccess}
                tabIndex={-1}
              >
                {state.mutation.message}
              </p>
            )}
          </div>

          {state.loadStatus === "unavailable" && (
            <div
              class="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800"
              role="alert"
            >
              <p>
                Saved rules are unavailable right now. Your settings have not
                been replaced with empty rules.
              </p>
              <button
                class={`${secondaryButtonClass} mt-3`}
                type="button"
                onClick={() => void loadSettings()}
              >
                Retry loading
              </button>
            </div>
          )}

          {state.mutation.status === "failed" && (
            <p
              class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800"
              role="alert"
            >
              {state.mutation.message}
            </p>
          )}

          {state.resetConfirmation === "open" && (
            <div
              aria-labelledby="reset-saved-rules-heading"
              class="settings-confirmation mb-6 rounded-md border border-red-200 bg-white px-4 py-4"
              id={RESET_CONFIRMATION_ID}
              ref={resetConfirmation}
              role="region"
              tabIndex={-1}
            >
              <h2
                class="text-base font-semibold text-zinc-950"
                id="reset-saved-rules-heading"
              >
                Reset all saved rules?
              </h2>
              <p class="mt-2 text-sm text-zinc-700">
                This removes all saved rule types:
              </p>
              <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                <li>Always-paused sites.</li>
                <li>Site-specific hostname allows.</li>
                <li>Global hostname overrides.</li>
              </ul>
              <p class="mt-3 text-sm text-zinc-700">
                Tab-scoped “pause once” state is not part of saved rules and is
                unaffected.
              </p>
              <div class="mt-4 flex flex-wrap gap-2">
                <button
                  class={secondaryButtonClass}
                  disabled={state.mutation.status === "pending"}
                  type="button"
                  onClick={closeResetConfirmation}
                >
                  Cancel
                </button>
                <button
                  class={destructiveButtonClass}
                  disabled={
                    state.mutation.status === "pending" || !state.settings
                  }
                  type="button"
                  onClick={() =>
                    void runSettingsMutation(
                      { kind: "reset-saved-rules" },
                      { type: RESET_SETTINGS_MESSAGE },
                    )
                  }
                >
                  Reset saved rules
                </button>
              </div>
            </div>
          )}

          {state.loadStatus === "ready" && settingsView && (
            <>
              <section class="mb-6">
                <h2 class="text-sm font-medium text-zinc-700">
                  Always-paused sites
                </h2>
                <SettingRows
                  disabled={mutationControlsDisabled}
                  emptyText="No always-paused sites."
                  items={settingsView.pausedSites.map((site) => ({
                    id: site,
                    label: site,
                    value: "Protection always paused",
                    actionLabel: "Resume",
                    actionAccessibleLabel: `Resume protection on ${site}`,
                    onAction: () =>
                      void runSettingsMutation(
                        { kind: "remove-site-pause", site },
                        {
                          type: UPDATE_SITE_PAUSE_MESSAGE,
                          site,
                          mode: null,
                        },
                      ),
                  }))}
                />
              </section>

              <section class="mb-6">
                <h2 class="text-sm font-medium text-zinc-700">
                  Allowed on one site
                </h2>
                <SettingRows
                  disabled={mutationControlsDisabled}
                  emptyText="No site-specific hostname allows."
                  items={settingsView.siteAllows.map(({ site, domain }) => ({
                    id: `${site}:${domain}`,
                    label: domain,
                    value: `Allowed only on ${site}`,
                    actionLabel: "Remove",
                    actionAccessibleLabel: `Remove allow for ${domain} on ${site}`,
                    onAction: () =>
                      void runSettingsMutation(
                        { kind: "remove-site-allow", site, domain },
                        {
                          type: SET_SITE_ALLOW_MESSAGE,
                          site,
                          domain,
                          allowed: false,
                        },
                      ),
                  }))}
                />
              </section>

              <section class="mb-6">
                <h2 class="text-sm font-medium text-zinc-700">
                  Global hostname overrides
                </h2>
                <SettingRows
                  disabled={mutationControlsDisabled}
                  emptyText="No hostname overrides."
                  items={settingsView.domainOverrides.map(
                    ([domain, action]) => ({
                      id: domain,
                      label: domain,
                      value: formatOverrideAction(action),
                      actionLabel: "Restore automatic",
                      actionAccessibleLabel: `Use automatic handling for ${domain}`,
                      onAction: () =>
                        void runSettingsMutation(
                          { kind: "reset-domain-override", domain },
                          {
                            type: SET_DOMAIN_OVERRIDE_MESSAGE,
                            domain,
                            action: null,
                          },
                        ),
                    }),
                  )}
                />
              </section>
            </>
          )}
        </div>

        <Troubleshooting
          extensionVersion={extensionVersion}
          health={health}
          onRetry={() => void loadHealth()}
          status={healthStatus}
        />

        <p class="border-t border-zinc-200 pt-4 text-sm text-zinc-600">
          Settings and local controls stay on this device. Tracker Blocker does
          not use telemetry, accounts, sync, remote classification, or runtime
          explanation fetches.
        </p>
      </div>
    </main>
  );
}

function Troubleshooting({
  extensionVersion,
  health,
  onRetry,
  status,
}: {
  extensionVersion: string;
  health: HealthCheckResponse | null;
  onRetry: () => void;
  status: DiagnosticsStatus;
}) {
  const provenance = health?.easyPrivacy.provenance;
  const isHealthy = Boolean(
    health &&
      health.easyPrivacy.engineHealth === "ready" &&
      health.easyPrivacy.hostPermissionGranted &&
      health.settings.health === "ready" &&
      health.settings.hasUsableSnapshot,
  );
  const summary =
    status === "loading"
      ? "Checking system health..."
      : status === "unavailable"
        ? "Diagnostic information is unavailable"
        : isHealthy
          ? "Everything is working"
          : "Attention may be needed";

  return (
    <section class="mb-6">
      <h2 class="text-sm font-medium text-zinc-700">
        Troubleshooting
      </h2>
      <details class="mt-3 rounded-md border border-zinc-200 bg-white">
        <summary class="cursor-pointer px-3 py-3 text-sm font-medium text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4fd1] focus-visible:ring-inset">
          <span class="ml-1">System diagnostics</span>
          <span class="ml-2 font-normal text-zinc-500">— {summary}</span>
        </summary>

        <div class="border-t border-zinc-200 px-3 py-3">
          {status === "loading" && (
            <p class="text-sm text-zinc-500">
              Checking extension health…
            </p>
          )}

          {status === "unavailable" && (
            <div>
              <p class="text-sm text-red-700">
                Diagnostics are unavailable right now.
              </p>
              <button
                class={`${secondaryButtonClass} mt-3`}
                type="button"
                onClick={onRetry}
              >
                Retry diagnostics
              </button>
            </div>
          )}

          {status === "ready" && health && (
            <dl class="grid gap-2 text-sm">
              <DiagnosticRow
                label="Extension version"
                value={extensionVersion}
              />
              <DiagnosticRow
                label="EasyPrivacy"
                value={
                  health.easyPrivacy.matchingEnabled
                    ? "Enabled for this build"
                    : "Disabled for this build"
                }
              />
              <DiagnosticRow
                label="Filtering engine"
                value={formatHealthValue(
                  health.easyPrivacy.engineHealth,
                  health.easyPrivacy.degradedReason,
                )}
              />
              <DiagnosticRow
                label="Site access"
                value={
                  health.easyPrivacy.hostPermissionGranted
                    ? "Granted"
                    : "Missing"
                }
              />
              <DiagnosticRow
                label="Settings storage"
                value={formatHealthValue(
                  health.settings.health,
                  health.settings.degradedReason,
                )}
              />
              <DiagnosticRow
                label="Filter list"
                value={
                  provenance
                    ? `${provenance.upstreamVersion}; artifact ${provenance.artifactSha256.slice(0, 12)}; engine ${provenance.ghosteryPackageVersion}`
                    : "Provenance unavailable"
                }
              />
            </dl>
          )}
        </div>
      </details>
    </section>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="grid grid-cols-[minmax(96px,128px)_minmax(0,1fr)] gap-3">
      <dt class="font-medium text-zinc-500">{label}</dt>
      <dd class="m-0 min-w-0 break-words text-zinc-800">{value}</dd>
    </div>
  );
}

function formatHealthValue(
  health: string,
  degradedReason: string | null,
): string {
  return degradedReason ? `${health} (${degradedReason})` : health;
}

function SettingRows({
  disabled,
  emptyText,
  items,
}: {
  disabled: boolean;
  emptyText: string;
  items: Array<{
    id: string;
    label: string;
    value: string;
    actionLabel: string;
    actionAccessibleLabel: string;
    onAction: () => void;
  }>;
}) {
  if (items.length === 0) {
    return (
      <p class="mt-3 rounded-md border border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500">
        {emptyText}
      </p>
    );
  }

  return (
    <div class="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
      {items.map((item) => (
        <div
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
          key={item.id}
        >
          <div class="min-w-0">
            <p class="settings-hostname m-0 text-sm font-medium text-zinc-950">
              {item.label}
            </p>
            <p class="settings-hostname mt-1 text-xs text-zinc-500">
              {item.value}
            </p>
          </div>
          <button
            aria-label={item.actionAccessibleLabel}
            class={secondaryButtonClass}
            disabled={disabled}
            type="button"
            onClick={item.onAction}
          >
            {item.actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

function formatOverrideAction(action: DomainOverrideAction): string {
  return action === "block" ? "Always block" : "Always allow";
}

function getMutationPendingMessage(mutation: SettingsMutation): string {
  switch (mutation.kind) {
    case "remove-site-pause":
      return `Resuming protection on ${mutation.site}…`;
    case "remove-site-allow":
      return `Removing the allow for ${mutation.domain} on ${mutation.site}…`;
    case "reset-domain-override":
      return `Restoring automatic handling for ${mutation.domain}…`;
    case "reset-saved-rules":
      return "Resetting saved rules…";
  }
}

function getMutationSuccessMessage(mutation: SettingsMutation): string {
  switch (mutation.kind) {
    case "remove-site-pause":
      return `Protection resumed on ${mutation.site}.`;
    case "remove-site-allow":
      return `Removed the allow for ${mutation.domain} on ${mutation.site}.`;
    case "reset-domain-override":
      return `Automatic handling restored for ${mutation.domain}.`;
    case "reset-saved-rules":
      return "Saved rules were reset.";
  }
}

function getMutationFailureMessage(mutation: SettingsMutation): string {
  const action =
    mutation.kind === "remove-site-pause"
      ? "resume protection"
      : mutation.kind === "remove-site-allow"
        ? "remove the site-specific allow"
        : mutation.kind === "reset-domain-override"
          ? "restore automatic handling"
          : "reset saved rules";

  return `Could not ${action}. The saved rules shown here are unchanged. Try again.`;
}

const secondaryButtonClass =
  "min-h-[34px] rounded-[7px] border border-zinc-300 bg-white px-[9px] py-[5px] text-sm font-medium leading-none text-[#1644b8] transition hover:border-[#2864fc] hover:bg-[#edf2ff] focus-visible:ring-2 focus-visible:ring-[#1f4fd1] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const destructiveButtonClass =
  "min-h-[34px] rounded-[7px] border border-red-200 bg-white px-[9px] py-[5px] text-sm font-medium leading-none text-red-700 transition hover:border-red-300 focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
