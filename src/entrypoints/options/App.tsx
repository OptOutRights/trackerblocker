import { useEffect, useState } from "preact/hooks";
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
  isSettingsErrorResponse,
  isSettingsResponse,
} from "../../messaging/settings";
import type { DomainOverrideAction } from "../../shared/requestDecisions";
import type { TrackerBlockerSettings } from "../../storage/settings";

type LoadStatus = "loading" | "ready" | "unavailable";

export function App() {
  const [settings, setSettings] = useState<TrackerBlockerSettings | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [healthStatus, setHealthStatus] = useState<LoadStatus>("loading");

  async function loadSettings() {
    setStatus("loading");

    try {
      const response = await browser.runtime.sendMessage({
        type: GET_SETTINGS_MESSAGE,
      });

      if (
        isSettingsResponse(response) &&
        response.type === SETTINGS_RESPONSE
      ) {
        setSettings(response);
        setStatus("ready");
        return;
      }

      setStatus("unavailable");
    } catch {
      setStatus("unavailable");
    }
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

  async function removeSitePause(site: string) {
    try {
      const response = await browser.runtime.sendMessage({
        type: UPDATE_SITE_PAUSE_MESSAGE,
        site,
        mode: null,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setStatus("unavailable");
        return;
      }

      await loadSettings();
    } catch {
      setStatus("unavailable");
    }
  }

  async function resetDomainOverride(domain: string) {
    try {
      const response = await browser.runtime.sendMessage({
        type: SET_DOMAIN_OVERRIDE_MESSAGE,
        domain,
        action: null,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setStatus("unavailable");
        return;
      }

      await loadSettings();
    } catch {
      setStatus("unavailable");
    }
  }

  async function removeSiteAllow(site: string, domain: string) {
    try {
      const response = await browser.runtime.sendMessage({
        type: SET_SITE_ALLOW_MESSAGE,
        site,
        domain,
        allowed: false,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setStatus("unavailable");
        return;
      }

      await loadSettings();
    } catch {
      setStatus("unavailable");
    }
  }

  async function resetLocalSettings() {
    try {
      const response = await browser.runtime.sendMessage({
        type: RESET_SETTINGS_MESSAGE,
      });

      if (isSettingsErrorResponse(response) || !isSettingsResponse(response)) {
        setStatus("unavailable");
        return;
      }

      await loadSettings();
    } catch {
      setStatus("unavailable");
    }
  }

  const pausedSites = Object.keys(settings?.pausedSites ?? {}).sort();
  const domainOverrides = Object.entries(settings?.domainOverrides ?? {}).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const siteAllows = Object.entries(settings?.siteAllows ?? {})
    .flatMap(([site, domains]) =>
      Object.keys(domains).map((domain) => ({ site, domain })),
    )
    .sort(
      (left, right) =>
        left.site.localeCompare(right.site) ||
        left.domain.localeCompare(right.domain),
    );

  return (
    <main class="min-h-screen bg-zinc-50 text-zinc-950">
      <div class="mx-auto max-w-3xl px-4 py-6">
        <header class="mb-6 flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-medium uppercase text-emerald-700">
              TrackerBlocker
            </p>
            <h1 class="mt-1 text-2xl font-semibold">Options</h1>
          </div>
          <button
            class="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={status !== "ready"}
            type="button"
            onClick={() => void resetLocalSettings()}
          >
            Reset settings
          </button>
        </header>

        {status === "unavailable" && (
          <p class="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Settings are unavailable right now. Try reopening this page.
          </p>
        )}

        <section class="mb-6">
          <h2 class="text-sm font-medium uppercase text-zinc-500">
            Always-paused sites
          </h2>
          <SettingRows
            emptyText="No always-paused sites."
            items={pausedSites.map((site) => ({
              id: site,
              label: site,
              value: "Protection always paused",
              actionLabel: "Resume",
              onAction: () => void removeSitePause(site),
            }))}
          />
        </section>

        <section class="mb-6">
          <h2 class="text-sm font-medium uppercase text-zinc-500">
            Allowed on one site
          </h2>
          <SettingRows
            emptyText="No site-specific hostname allows."
            items={siteAllows.map(({ site, domain }) => ({
              id: `${site}:${domain}`,
              label: domain,
              value: `Allowed only on ${site}`,
              actionLabel: "Remove",
              onAction: () => void removeSiteAllow(site, domain),
            }))}
          />
        </section>

        <section class="mb-6">
          <h2 class="text-sm font-medium uppercase text-zinc-500">
            Global hostname overrides
          </h2>
          <SettingRows
            emptyText="No hostname overrides."
            items={domainOverrides.map(([domain, action]) => ({
              id: domain,
              label: domain,
              value: formatOverrideAction(action),
              actionLabel: "Auto",
              onAction: () => void resetDomainOverride(domain),
            }))}
          />
        </section>

        <Troubleshooting health={health} status={healthStatus} />

        <p class="border-t border-zinc-200 pt-4 text-sm text-zinc-600">
          Settings and local controls stay on this device. TrackerBlocker does
          not use telemetry, accounts, sync, remote classification, or runtime
          explanation fetches.
        </p>
      </div>
    </main>
  );
}

function Troubleshooting({
  health,
  status,
}: {
  health: HealthCheckResponse | null;
  status: LoadStatus;
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
      <h2 class="text-sm font-medium uppercase text-zinc-500">
        Troubleshooting
      </h2>
      <details class="mt-3 rounded-md border border-zinc-200 bg-white">
        <summary class="cursor-pointer px-3 py-3 text-sm font-medium text-zinc-800">
          <span class="ml-1">System diagnostics</span>
          <span class="ml-2 font-normal text-zinc-500">— {summary}</span>
        </summary>

        <div class="border-t border-zinc-200 px-3 py-3">
          {status === "loading" && (
            <p class="text-sm text-zinc-500">Checking extension health…</p>
          )}

          {status === "unavailable" && (
            <p class="text-sm text-red-700">
              Diagnostics are unavailable right now. Try reopening this page.
            </p>
          )}

          {status === "ready" && health && (
            <dl class="grid gap-2 text-sm">
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
    <div class="grid grid-cols-[128px_minmax(0,1fr)] gap-3">
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
  emptyText,
  items,
}: {
  emptyText: string;
  items: Array<{
    id: string;
    label: string;
    value: string;
    actionLabel: string;
    onAction: () => void;
  }>;
}) {
  if (items.length === 0) {
    return (
      <p class="mt-3 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-4 text-sm text-zinc-500">
        {emptyText}
      </p>
    );
  }

  return (
    <div class="mt-3 divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
      {items.map((item) => (
        <div
          class="flex items-center justify-between gap-4 px-3 py-3"
          key={item.id}
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-zinc-950">
              {item.label}
            </p>
            <p class="mt-1 text-xs text-zinc-500">{item.value}</p>
          </div>
          <button
            class="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400"
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
