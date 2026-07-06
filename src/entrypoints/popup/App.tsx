import { useEffect, useState } from "preact/hooks";
import { browser } from "wxt/browser";

import {
  HEALTH_CHECK_MESSAGE,
  HEALTH_CHECK_RESPONSE,
  type HealthCheckResponse,
} from "../../messaging/health";

type BackgroundStatus = "checking" | "ready" | "unavailable";

function formatHostname(url?: string): string {
  if (!url) {
    return "Unavailable";
  }

  try {
    return new URL(url).hostname || "Unavailable";
  } catch {
    return "Unavailable";
  }
}

function isHealthCheckResponse(value: unknown): value is HealthCheckResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === HEALTH_CHECK_RESPONSE &&
    "ok" in value &&
    value.ok === true &&
    "startedAt" in value &&
    typeof value.startedAt === "string"
  );
}

export function App() {
  const [activeHost, setActiveHost] = useState("Checking...");
  const [backgroundStatus, setBackgroundStatus] =
    useState<BackgroundStatus>("checking");

  useEffect(() => {
    let isMounted = true;

    async function loadPopupState() {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!isMounted) {
        return;
      }

      setActiveHost(formatHostname(tabs[0]?.url));

      try {
        const response = await browser.runtime.sendMessage({
          type: HEALTH_CHECK_MESSAGE,
        });

        setBackgroundStatus(
          isHealthCheckResponse(response) ? "ready" : "unavailable",
        );
      } catch {
        setBackgroundStatus("unavailable");
      }
    }

    loadPopupState().catch(() => {
      if (!isMounted) {
        return;
      }

      setActiveHost("Unavailable");
      setBackgroundStatus("unavailable");
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main class="w-[360px] bg-zinc-50 p-4 text-zinc-950">
      <section class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase text-emerald-700">
              TrackerBlocker
            </p>
            <h1 class="mt-1 text-xl font-semibold leading-tight">
              Firefox extension scaffold
            </h1>
          </div>
          <span class="rounded-full border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600">
            MV3
          </span>
        </div>

        <div class="mt-4 grid gap-2 text-sm">
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Current tab</span>
            <span class="truncate font-medium text-zinc-900">{activeHost}</span>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Background</span>
            <span class="font-medium text-zinc-900">{backgroundStatus}</span>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2">
            <span class="text-zinc-600">Storage</span>
            <span class="font-medium text-zinc-900">browser.storage.local</span>
          </div>
        </div>

        <div class="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p class="text-sm font-medium text-emerald-950">Scaffold ready</p>
          <p class="mt-2 text-sm text-emerald-900">
            Popup, background messaging, Firefox MV3 output, Tailwind styles,
            and local WebExtension APIs are wired.
          </p>
        </div>
      </section>
    </main>
  );
}
