import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProfile, run as runFirefox } from "../../node_modules/web-ext/lib/firefox/index.js";
import { connectWithMaxRetries } from "../../node_modules/web-ext/lib/firefox/remote.js";

import {
  FIREFOX_FIXTURE_HOSTS,
  startFirefoxFixtureServer,
} from "./firefox-fixture-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_SOURCE = process.env.EASYPRIVACY_EXTENSION_SOURCE
  ? path.resolve(process.env.EASYPRIVACY_EXTENSION_SOURCE)
  : path.join(ROOT, ".output/firefox-mv3");
const EXPECTED_ENGINE_HEALTH =
  process.env.EASYPRIVACY_EXPECT_ENGINE_HEALTH ?? "ready";
const EXPECTED_MATCHING =
  process.env.EASYPRIVACY_EXPECT_MATCHING !== "false";
const EXPECTED_HOST_PERMISSION =
  process.env.EASYPRIVACY_EXPECT_HOST_PERMISSION !== "false";
const NETWORK_ONLY = process.env.EASYPRIVACY_NETWORK_ONLY === "true";
const OPTIONS_ONLY = process.env.EASYPRIVACY_OPTIONS_ONLY === "true";
const EXTENSION_NAME = "Tracker Blocker by Opt Out Rights";
const EXTENSION_ID = "trackerblocker@optoutrights.org";
const HEALTH = "trackerblocker.healthCheck";
const RESET = "trackerblocker.resetSettings";
const UPDATE_PAUSE = "trackerblocker.updateSitePause";
const SET_OVERRIDE = "trackerblocker.setDomainOverride";
const SET_SITE_ALLOW = "trackerblocker.setSiteAllow";
const GET_SETTINGS = "trackerblocker.getSettings";
const GET_SUMMARY = "trackerblocker.getTabRequestSummary";
const GET_HOST_DETAILS = "trackerblocker.getHostRequestDetails";
const FIREFOX_BINARY = await resolveFirefoxBinary();
const checkpoints = [];
let fixture;
let profile;
let probeSequence = 0;

async function main() {
  await verifyBuild();
  fixture = await startFirefoxFixtureServer();
  profile = await createProfile({ customPrefs: createQaPreferences() });
  let session;
  try {
    session = await startSession();
    if (OPTIONS_ONLY) {
      await runOptionsCoverage(session);
      report();
      return;
    }
    if (!EXPECTED_MATCHING) {
      await runDisabledCoverage(session);
      report();
      return;
    }
    if (!EXPECTED_HOST_PERMISSION) {
      await delay(100);
      const sessionState = await getStoredSessionState(session);
      assert.deepEqual(sessionState.enforcementLedger, {});
      checkpoint("missing host permission is visible in extension health");
      checkpoint("missing host permission leaves no active blocked-count ledger");
      report();
      return;
    }
    if (EXPECTED_ENGINE_HEALTH === "degraded") {
      await runDegradedCoverage(session);
      report();
      return;
    }
    if (NETWORK_ONLY) {
      await runNetworkCoverage(session);
      report();
      return;
    }
    await runNetworkCoverage(session);
    await runBlockedCountLifecycleCoverage(session);
    await runRecoveryCoverage(session);
    await stopSession(session);
    session = await startSession();
    await runBrowserRestartCoverage(session);
    await stopSession(session);
    session = await startSession();
    await runDurablePauseRestartCoverage(session);
    report();
  } catch (error) {
    process.stderr.write(
      `Recent fixture requests: ${JSON.stringify(fixture.requests.slice(-20), null, 2)}\n`,
    );
    throw error;
  } finally {
    await stopSession(session).catch(() => undefined);
    await fixture.close();
  }
}

async function startSession() {
  const fixtureUrl = fixture.url("publisher.test", "/probe/control?startup=1");
  const controlUrl = fixture.url("example.test", "/probe/control?startup=1");
  const running = await runFirefox(profile, {
    firefoxBinary: FIREFOX_BINARY,
    binaryArgs: [
      ...(process.env.FIREFOX_HEADLESS === "false" ? [] : ["-headless"]),
      "--url",
      fixtureUrl,
      "--url",
      controlUrl,
    ],
    extensions: [{ sourceDir: EXTENSION_SOURCE }],
    devtools: false,
  });
  const remote = await connectWithMaxRetries({
    port: running.debuggerPort,
    maxRetries: 200,
    retryInterval: 100,
  });
  const protocol = new FirefoxProtocol(remote.client);
  await remote.installTemporaryAddon(EXTENSION_SOURCE, false);
  const addon = await findAddon(remote);
  const tabs = await waitForTabs(remote, [fixtureUrl, controlUrl]);
  const fixtureTab = tabs.find(({ url }) => url === fixtureUrl);
  const controlTab = tabs.find(({ url }) => url === controlUrl);
  assert(fixtureTab && controlTab);

  const optionsUrl = new URL("options.html", addon.manifestURL).href;
  await protocol.navigate(controlTab, optionsUrl);
  const health = await waitForBackground(protocol, controlTab);
  const runtimeManifest = await protocol.evaluateJson(
    controlTab,
    "browser.runtime.getManifest()",
  );
  assert.equal(addon.name, EXTENSION_NAME);
  assert.equal(runtimeManifest.name, EXTENSION_NAME);
  assert.equal(
    runtimeManifest.browser_specific_settings?.gecko?.id,
    EXTENSION_ID,
  );
  assert.equal(health.easyPrivacy.matchingEnabled, EXPECTED_MATCHING);
  assert.equal(health.easyPrivacy.engineHealth, EXPECTED_ENGINE_HEALTH);
  assert.equal(
    health.easyPrivacy.hostPermissionGranted,
    EXPECTED_HOST_PERMISSION,
  );
  const browserTabs = await protocol.evaluateJson(
    controlTab,
    "browser.tabs.query({})",
  );
  const fixtureBrowserTab = browserTabs.find(({ url }) => url === fixtureUrl);
  if (EXPECTED_HOST_PERMISSION) assert(fixtureBrowserTab);
  return {
    addon,
    controlTab,
    fixtureBrowserTabId: fixtureBrowserTab?.id ?? -1,
    fixtureTab,
    health,
    protocol,
    remote,
    running,
  };
}

async function runBlockedCountLifecycleCoverage(current) {
  await sendMessage(current, { type: RESET });
  const publisherUrl = fixture.url("publisher.test", "/probe/control");
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });

  let summary = await getCurrentSummary(current);
  assert.deepEqual(summary.enforcement, { status: "active", blockedCount: 1 });
  assert.deepEqual(await getBadgePresentation(current), {
    text: "1",
    title: "Tracker Blocker — 1 request blocked",
  });
  assert.deepEqual(await readPopupProtection(current), {
    value: "1",
    label: "Request blocked",
  });
  const nativeDocumentIds = await supportsNativeDocumentIds(current);
  const activeSession = await getStoredSessionState(current);
  assert.equal(
    String(current.fixtureBrowserTabId) in activeSession.enforcementLedger,
    nativeDocumentIds,
  );

  await switchAwayAndBack(current);
  assert.equal((await getCurrentSummary(current)).enforcement.blockedCount, 1);
  await terminateBackground(current);
  if (nativeDocumentIds) {
    assert.deepEqual(await readPopupProtection(current), {
      value: "1",
      label: "Request blocked",
    });
    assert.deepEqual(await getBadgePresentation(current), {
      text: "1",
      title: "Tracker Blocker — 1 request blocked",
    });
    checkpoint("native document id restores the count after MV3 termination");
  } else {
    assert.deepEqual(await readPopupProtection(current), {
      value: "—",
      label: "Blocked count unavailable",
    });
    assert.equal((await getBadgePresentation(current)).text, "!");
    checkpoint("unverifiable count becomes unavailable after MV3 termination");
  }

  await terminateBackground(current);
  const coldOutcome = await current.protocol.evaluateJson(
    current.fixtureTab,
    `new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve("loaded");
      image.onerror = () => resolve("blocked");
      image.src = "http://screen13.com/collect/cold-start?resource=image&qa=" + Math.random();
    })`,
  );
  assert.equal(coldOutcome, "blocked");
  summary = await getCurrentSummary(current);
  if (nativeDocumentIds) {
    assert.deepEqual(summary.enforcement, { status: "active", blockedCount: 2 });
    assert.deepEqual(await getBadgePresentation(current), {
      text: "2",
      title: "Tracker Blocker — 2 requests blocked",
    });
    checkpoint("cold EasyPrivacy-only request increments the restored count");
  } else {
    assert.deepEqual(summary.enforcement, {
      status: "unavailable",
      blockedCount: null,
    });
    assert.deepEqual(await getBadgePresentation(current), {
      text: "!",
      title: "Tracker Blocker — blocked count unavailable",
    });
    checkpoint("cold blocking continues while the count remains unavailable");
  }

  current.lastProbeUrl = await current.protocol.evaluateJson(
    current.fixtureTab,
    `(() => {
      history.pushState({}, "", "/probe/control?lifecycle=push");
      location.hash = "preserved";
      return location.href;
    })()`,
  );
  await delay(100);
  summary = await getCurrentSummary(current);
  assert.equal(
    summary.enforcement.blockedCount,
    nativeDocumentIds ? 2 : null,
  );
  assert.equal(
    (await getBadgePresentation(current)).text,
    nativeDocumentIds ? "2" : "!",
  );
  checkpoint("same-document navigation preserves count availability");

  assert.deepEqual(
    await runProbe(current, fixture.url("publisher.test", "/probe/quiet")),
    {},
  );
  summary = await getCurrentSummary(current);
  assert.deepEqual(summary.enforcement, { status: "active", blockedCount: 0 });
  assert.deepEqual(await getBadgePresentation(current), {
    text: "",
    title: "Tracker Blocker",
  });
  checkpoint("full navigation resets blocked count");

  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });
  const reloadUrl = current.lastProbeUrl;
  await current.protocol.navigate(current.fixtureTab, reloadUrl);
  assert.deepEqual(await current.protocol.waitForFixture(current.fixtureTab), {
    "screen13-image": "blocked",
  });
  current.lastProbeUrl = reloadUrl;
  assert.equal((await getCurrentSummary(current)).enforcement.blockedCount, 1);
  checkpoint("reload starts a new blocked count");
  if (nativeDocumentIds) {
    const staleSession = await getStoredSessionState(current);
    staleSession.enforcementLedger[String(current.fixtureBrowserTabId)] = {
      documentId: "stale-document-id",
      blockedCount: 99,
    };
    await setStoredSessionState(current, staleSession);
    await terminateBackground(current);
    assert.deepEqual((await getCurrentSummary(current)).enforcement, {
      status: "unavailable",
      blockedCount: null,
    });
    assert.equal(
      String(current.fixtureBrowserTabId) in
        (await getStoredSessionState(current)).enforcementLedger,
      false,
    );
    checkpoint("mismatched native document id cannot restore a stale count");
  }
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "once",
    tabId: current.fixtureBrowserTabId,
  });
  summary = await getCurrentSummary(current);
  assert.deepEqual(summary.enforcement, { status: "paused", blockedCount: null });
  assert.deepEqual(await getBadgePresentation(current), {
    text: "",
    title: "Tracker Blocker — protection paused",
  });
  const pausedSession = await getStoredSessionState(current);
  assert.equal(
    String(current.fixtureBrowserTabId) in pausedSession.enforcementLedger,
    false,
  );
  checkpoint("site pause deletes the active blocked count");

  const closeUrl = fixture.url("publisher.test", "/probe/control?ledger-close=1");
  const closeTab = await current.protocol.evaluateJson(
    current.controlTab,
    `browser.tabs.create({ active: false, url: ${JSON.stringify(closeUrl)} })`,
  );
  const closeRdp = await waitForBrowserTab(current, closeTab.id, closeUrl);
  assert.deepEqual(await current.protocol.waitForFixture(closeRdp), {
    "screen13-image": "blocked",
  });
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.remove(${closeTab.id}), true)`,
  );
  await waitForLedgerRemoval(current, closeTab.id);
  checkpoint("tab closure deletes its blocked-count ledger entry");

  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: null,
    tabId: current.fixtureBrowserTabId,
  });

  const unsupportedTab = await current.protocol.evaluateJson(
    current.controlTab,
    "browser.tabs.create({ active: false, url: 'about:blank' })",
  );
  await delay(100);
  assert.deepEqual(
    (
      await sendMessage(current, {
        type: GET_SUMMARY,
        tabId: unsupportedTab.id,
        pageUrl: "about:blank",
      })
    ).enforcement,
    { status: "unavailable", blockedCount: null },
  );
  assert.equal((await getBadgePresentation(current, unsupportedTab.id)).text, "!");
  assert.equal(
    String(unsupportedTab.id) in
      (await getStoredSessionState(current)).enforcementLedger,
    false,
  );
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.remove(${unsupportedTab.id}), true)`,
  );
  checkpoint("unsupported pages never claim an active blocked count");
}

async function stopSession(current) {
  if (!current) return;
  current.remote.disconnect();
  if (current.running.firefox.exitCode !== null) return;
  const closed = new Promise((resolve) =>
    current.running.firefox.once("close", resolve),
  );
  current.running.firefox.kill();
  await closed;
}

async function runNetworkCoverage(current) {
  await sendMessage(current, { type: RESET });
  const publisherUrl = fixture.url("publisher.test", "/probe/publisher");
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "firecrux-script": "loaded",
    "firecrux-xhr": "blocked",
    "ordinary-allowed-script": "loaded",
    "privacy-image": "blocked",
    "redirect-image": "blocked",
    "screen13-image": "blocked",
    "screen13-script": "loaded",
    "websocket-block": "blocked",
    "websocket-control": "loaded",
  });
  const summary = await sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
  if (process.env.EASYPRIVACY_DEBUG_SUMMARY === "true") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
  assert.deepEqual(summary.requestCounts, {
    total: 10,
    blocked: 5,
    restricted: 0,
    allowed: 5,
  });
  assert.deepEqual(summary.hostCounts, {
    observed: 6,
    thirdParty: 6,
    unknown: 6,
    firstParty: 0,
    blocked: 3,
    restricted: 0,
    allowed: 5,
    mixed: 2,
    lowerBound: false,
  });
  const screen13 = summary.rows.find(({ host }) => host === "screen13.com");
  assert(screen13?.isMixed);
  const details = await sendMessage(current, {
    type: GET_HOST_DETAILS,
    tabId: current.fixtureBrowserTabId,
    generation: summary.generation,
    rowId: screen13.id,
  });
  if (process.env.EASYPRIVACY_DEBUG_SUMMARY === "true") {
    process.stdout.write(`${JSON.stringify(details, null, 2)}\n`);
  }
  assert.deepEqual(screen13.actionCounts, {
    total: 4,
    blocked: 3,
    restricted: 0,
    allowed: 1,
  });
  assert.equal(details.details?.truncated, false);
  assert.deepEqual(
    details.details?.samples
      .map(({ action, attemptIndex, pathHint, requestType, source }) => ({
        action,
        attemptIndex,
        pathHint,
        requestType,
        source,
      }))
      .sort((left, right) => left.pathHint.localeCompare(right.pathHint)),
    [
      {
        action: "block",
        attemptIndex: 0,
        pathHint: "/collect/pixel",
        requestType: "image",
        source: "easyprivacy",
      },
      {
        action: "block",
        attemptIndex: 1,
        pathHint: "/conversion/pixel",
        requestType: "image",
        source: "easyprivacy",
      },
      {
        action: "allow",
        attemptIndex: 0,
        pathHint: "/script/pixel",
        requestType: "script",
        source: "default",
      },
      {
        action: "block",
        attemptIndex: 0,
        pathHint: "/users/…/…/pixel.png",
        requestType: "image",
        source: "easyprivacy",
      },
    ],
  );
  const firecrux = summary.rows.find(({ host }) => host === "firecrux.com");
  assert.deepEqual(firecrux?.actionCounts, {
    total: 2,
    blocked: 1,
    restricted: 0,
    allowed: 1,
  });
  const websocketBlock = summary.rows.find(({ host }) => host === "neowin.net");
  assert.deepEqual(websocketBlock?.actionCounts, {
    total: 1,
    blocked: 1,
    restricted: 0,
    allowed: 0,
  });
  assert.deepEqual(websocketBlock?.requestTypes, ["websocket"]);
  assert.equal(websocketBlock?.sourceCounts.easyprivacy, 1);
  assert.equal(websocketBlock?.lifecycle.blocked, 1);
  assert.equal(websocketBlock?.lifecycle.failed, 0);
  const websocketControl = summary.rows.find(({ host }) => host === "127.0.0.1");
  assert.deepEqual(websocketControl?.actionCounts, {
    total: 1,
    blocked: 0,
    restricted: 0,
    allowed: 1,
  });
  assert.equal(websocketControl?.lifecycle.completed, 1);
  const redirectSource = summary.rows.find(({ host }) => host === "first.test");
  assert.deepEqual(
    redirectSource?.redirectHops.map(({ fromHost, toHost, statusCode }) => ({
      fromHost,
      toHost,
      statusCode,
    })),
    [{ fromHost: "first.test", toHost: "screen13.com", statusCode: 302 }],
  );
  const serialized = JSON.stringify(summary);
  for (const forbidden of [
    "person@example.test",
    "person%40example.test",
    "550e8400-e29b-41d4-a716-446655440000",
    "private-value",
    "token=",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  checkpoint(
    "ordinary/type/WebSocket blocks, redirect, mixed host, and privacy summary",
  );

  assert.deepEqual(
    await runProbe(current, fixture.url("abema.tv", "/probe/exception")),
    { "newrelic-exception": "loaded" },
  );
  checkpoint("EasyPrivacy exception allowance");

  assert.deepEqual(
    await runProbe(current, fixture.url("news.yahoo.com", "/probe/source")),
    { "yahoo-source-script": "blocked" },
  );
  assert.deepEqual(
    await runProbe(current, fixture.url("example.test", "/probe/source")),
    { "yahoo-source-script": "loaded" },
  );
  checkpoint("top-level source-site positive and negative controls");

  assert.deepEqual(
    await runProbe(current, fixture.url("search.brave.com", "/probe/first-party")),
    { "first-party-control": "loaded", "first-party-feedback": "blocked" },
  );
  checkpoint("first-party path positive and negative controls");

  assert.deepEqual(
    await runProbe(current, fixture.url("publisher.test", "/probe/frame")),
    { "framed-negative": "loaded", "framed-positive": "blocked" },
  );
  checkpoint("framed source positive and negative controls");

  assert.deepEqual(
    await runProbe(current, fixture.url("publisher.test", "/probe/spa")),
    { "spa-image": "blocked" },
  );
  current.lastProbeUrl = await current.protocol.evaluateJson(
    current.fixtureTab,
    "location.href",
  );
  const spaSummary = await sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
  assert.deepEqual(spaSummary.requestCounts, {
    total: 1,
    blocked: 1,
    restricted: 0,
    allowed: 0,
  });
  assert.deepEqual(spaSummary.rows[0]?.actionCounts, {
    total: 1,
    blocked: 1,
    restricted: 0,
    allowed: 0,
  });
  checkpoint("same-document navigation keeps current requests observable");

  const mainFrameUrl = fixture.url(
    "00px.net",
    "/main-frame",
  );
  await current.protocol.navigate(current.fixtureTab, mainFrameUrl);
  assert.deepEqual(
    await current.protocol.evaluateJson(current.fixtureTab, `({
      url: location.href,
      text: document.querySelector("#main-frame")?.textContent ?? null,
    })`),
    { text: "loaded", url: mainFrameUrl },
  );
  checkpoint("automatic EasyPrivacy main-frame cancellation remains disabled");
}

async function runDegradedCoverage(current) {
  assert.equal(current.health.easyPrivacy.degradedReason, "artifact-invalid");
  await sendMessage(current, { type: RESET });
  assert.deepEqual(
    await runProbe(current, fixture.url("publisher.test", "/probe/degraded")),
    {
      "catalog-google-analytics": "blocked",
      "easyprivacy-only-screen13": "loaded",
      "sentry-referer": "absent",
    },
  );
  checkpoint("invalid artifact degrades safely to catalog policy");
  const summary = await sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
  const sentry = summary.rows.find(
    ({ host }) => host === "functional.sentry.io",
  );
  assert.equal(sentry?.actionCounts.restricted, 1);
  assert.deepEqual(summary.enforcement, {
    status: "unavailable",
    blockedCount: null,
  });
  assert.deepEqual(await getBadgePresentation(current), {
    text: "!",
    title: "Tracker Blocker — blocked count unavailable",
  });
  assert.deepEqual(await readPopupProtection(current), {
    value: "—",
    label: "Blocked count unavailable",
  });
  const session = await getStoredSessionState(current);
  assert.equal(
    String(current.fixtureBrowserTabId) in session.enforcementLedger,
    false,
  );
  checkpoint("degraded protection invalidates the blocked count");
  checkpoint("degraded catalog restriction strips Referer");
}

async function runDisabledCoverage(current) {
  await sendMessage(current, { type: RESET });
  assert.deepEqual(
    await runProbe(current, fixture.url("publisher.test", "/probe/degraded")),
    {
      "catalog-google-analytics": "blocked",
      "easyprivacy-only-screen13": "loaded",
      "sentry-referer": "absent",
    },
  );
  const summary = await sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
  assert.deepEqual(
    summary.rows.find(({ host }) => host === "screen13.com")?.actionCounts,
    { total: 1, blocked: 0, restricted: 0, allowed: 1 },
  );
  assert.deepEqual(
    summary.rows.find(({ host }) => host === "www.google-analytics.com")
      ?.actionCounts,
    { total: 1, blocked: 1, restricted: 0, allowed: 0 },
  );
  const mainFrameUrl = fixture.url(
    "00px.net",
    "/main-frame",
  );
  await current.protocol.navigate(current.fixtureTab, mainFrameUrl);
  assert.deepEqual(
    await current.protocol.evaluateJson(current.fixtureTab, `({
      url: location.href,
      text: document.querySelector("#main-frame")?.textContent ?? null,
    })`),
    { text: "loaded", url: mainFrameUrl },
  );
  checkpoint("explicit emergency-off build preserves catalog policy");
  checkpoint("explicit emergency-off build preserves main-frame non-enforcement");
}

async function runRecoveryCoverage(current) {
  await sendMessage(current, { type: RESET });
  const publisherUrl = fixture.url("publisher.test", "/probe/control");
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "once",
    tabId: current.fixtureBrowserTabId,
  });
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "loaded",
  });

  let previousStartedAt = (await sendMessage(current, { type: HEALTH })).startedAt;
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    await delay(5);
    await withTimeout(
      current.remote.client.request({
        to: current.addon.actor,
        type: "terminateBackgroundScript",
      }),
      10_000,
      `Worker cycle ${cycle} did not terminate in time.`,
    );
    assert.deepEqual(await runProbe(current, publisherUrl), {
      "screen13-image": "loaded",
    });
    const health = await waitForBackground(current.protocol, current.controlTab);
    assert.notEqual(health.startedAt, previousStartedAt);
    previousStartedAt = health.startedAt;
  }
  checkpoint("pause-once survives five forced MV3 worker restarts");

  const closeUrl = fixture.url("publisher.test", "/probe/control?close=1");
  const closeTab = await current.protocol.evaluateJson(
    current.controlTab,
    `browser.tabs.create({ active: false, url: ${JSON.stringify(closeUrl)} })`,
  );
  await waitForBrowserTab(current, closeTab.id, closeUrl);
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "once",
    tabId: closeTab.id,
  });
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.remove(${closeTab.id}), true)`,
  );
  await waitForPauseRemoval(current, closeTab.id);
  checkpoint("pause-once clears when its tab closes");

  await runProbe(current, fixture.url("example.test", "/probe/control"));
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });
  checkpoint("pause-once clears after cross-site navigation");

  const staleSourceUrl = current.lastProbeUrl;
  await runProbe(current, publisherUrl);
  const staleSummary = await sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
  const staleRow = staleSummary.rows.find(({ host }) => host === "screen13.com");
  assert(staleRow);
  await runProbe(current, fixture.url("example.test", "/probe/control"));
  assert.deepEqual(
    await sendMessage(current, {
      type: SET_SITE_ALLOW,
      site: "publisher.test",
      domain: "screen13.com",
      allowed: true,
      tabId: current.fixtureBrowserTabId,
      generation: staleSummary.generation,
      rowId: staleRow.id,
    }),
    { reason: "stale-page", type: "trackerblocker.settingsErrorResponse" },
  );
  assert.notEqual(current.lastProbeUrl, staleSourceUrl);
  assert.deepEqual((await sendMessage(current, { type: GET_SETTINGS })).siteAllows, {});
  checkpoint("stale popup context cannot mutate the newly navigated page");

  await sendMessage(current, {
    type: SET_SITE_ALLOW,
    site: "publisher.test",
    domain: "screen13.com",
    allowed: true,
  });
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "loaded",
  });
  assert.deepEqual(
    await runProbe(current, fixture.url("example.test", "/probe/control")),
    { "screen13-image": "blocked" },
  );
  checkpoint("exact-site allow recovers only the selected site");

  await sendMessage(current, { type: RESET });
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: "screen13.com",
    action: "allow",
  });
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "loaded",
  });
  checkpoint("global Allow recovers an EasyPrivacy block");

  await sendMessage(current, { type: RESET });
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: "bam.nr-data.net",
    action: "block",
  });
  assert.deepEqual(
    await runProbe(current, fixture.url("abema.tv", "/probe/exception")),
    { "newrelic-exception": "blocked" },
  );
  checkpoint("global Block supersedes an EasyPrivacy exception");

  await sendMessage(current, { type: RESET });
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: "screen13.com",
    action: "allow",
  });
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "once",
    tabId: current.fixtureBrowserTabId,
  });
}

async function runBrowserRestartCoverage(current) {
  const publisherUrl = fixture.url("publisher.test", "/probe/control");
  const settings = await sendMessage(current, { type: GET_SETTINGS });
  assert.equal(settings.domainOverrides["screen13.com"], "allow");
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "loaded",
  });
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: "screen13.com",
    action: null,
  });
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });
  checkpoint("durable override survives restart; pause-once does not");

  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "always",
    tabId: current.fixtureBrowserTabId,
  });
  const secondUrl = fixture.url("publisher.test", "/probe/control?second=1");
  const second = await current.protocol.evaluateJson(
    current.controlTab,
    `browser.tabs.create({ active: false, url: ${JSON.stringify(secondUrl)} })`,
  );
  const secondRdp = await waitForBrowserTab(current, second.id, secondUrl);
  assert.deepEqual(await current.protocol.waitForFixture(secondRdp), {
    "screen13-image": "loaded",
  });
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.remove(${second.id}), true)`,
  );
  checkpoint("pause-always applies in another tab");
}

async function runDurablePauseRestartCoverage(current) {
  const publisherUrl = fixture.url("publisher.test", "/probe/control");
  const settings = await sendMessage(current, { type: GET_SETTINGS });
  assert.equal(settings.pausedSites["publisher.test"], true);
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "loaded",
  });
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: null,
    tabId: current.fixtureBrowserTabId,
  });
  assert.deepEqual(await runProbe(current, publisherUrl), {
    "screen13-image": "blocked",
  });
  checkpoint("pause-always survives restart and resumes cleanly");

  const storage = await current.protocol.evaluateJson(current.controlTab, `({
    local: await browser.storage.local.get(null),
    session: await browser.storage.session.get(null),
  })`);
  assert.deepEqual(Object.keys(storage.local), ["trackerblocker:settings"]);
  assert.deepEqual(Object.keys(storage.session), ["trackerblocker:session-state"]);
  assert.equal(storage.local["trackerblocker:settings"].schemaVersion, 2);
  assert.equal(storage.session["trackerblocker:session-state"].schemaVersion, 3);
  const sessionKeys = Object.keys(
    storage.session["trackerblocker:session-state"],
  ).sort();
  assert.deepEqual(sessionKeys, [
    "enforcementLedger",
    "enforcementLedgerInitialized",
    "schemaVersion",
    "temporarySitePauses",
  ]);
  for (const entry of Object.values(
    storage.session["trackerblocker:session-state"].enforcementLedger,
  )) {
    assert.deepEqual(Object.keys(entry).sort(), ["blockedCount", "documentId"]);
  }
  const serialized = JSON.stringify(storage);
  for (const forbidden of ["person%40example.test", "private-value", "token="]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  checkpoint("durable and session storage contain only documented state");
  await runOptionsCoverage(current);
}

async function runOptionsCoverage(current) {
  await sendMessage(current, { type: RESET });
  await sendMessage(current, {
    type: UPDATE_PAUSE,
    site: "publisher.test",
    mode: "always",
    tabId: current.fixtureBrowserTabId,
  });
  await sendMessage(current, {
    type: SET_SITE_ALLOW,
    site: "publisher.test",
    domain: "screen13.com",
    allowed: true,
  });
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: "override.test",
    action: "allow",
  });
  const optionsUrl = new URL("options.html", current.addon.manifestURL).href;
  await current.protocol.navigate(current.controlTab, `${optionsUrl}?seeded-rules`);
  const populatedPage = await waitForOptionsPage(current, {
    include: [
      "Tracker Blocker Settings",
      "by Opt Out Rights",
      "Create rules from the toolbar popup. Review or remove saved rules here.",
      "publisher.test",
      "screen13.com",
      "override.test",
      "Extension version",
    ],
    exclude: [
      "No always-paused sites.",
      "No site-specific hostname allows.",
      "No hostname overrides.",
    ],
  });
  assert.equal(populatedPage.documentTitle, "Tracker Blocker settings");
  assert.equal(populatedPage.busy, "false");
  assert.equal(
    populatedPage.buttons.find(({ text }) => text === "Resume")?.ariaLabel,
    "Resume protection on publisher.test",
  );
  assert.equal(
    populatedPage.buttons.find(({ text }) => text === "Remove")?.ariaLabel,
    "Remove allow for screen13.com on publisher.test",
  );
  assert.equal(
    populatedPage.buttons.find(({ text }) => text === "Restore automatic")
      ?.ariaLabel,
    "Use automatic handling for override.test",
  );
  checkpoint("options render seeded rules with target-specific action labels");
  for (const label of ["Resume", "Remove", "Restore automatic"]) {
    await clickButton(current, label);
  }
  let settings = await sendMessage(current, { type: GET_SETTINGS });
  assert.deepEqual(settings.pausedSites, {});
  assert.deepEqual(settings.siteAllows, {});
  assert.deepEqual(settings.domainOverrides, {});
  checkpoint("options remove all three saved-rule types");

  const longHostname =
    "a-very-long-hostname-segment-for-settings.example.another-long-segment.test";
  await sendMessage(current, {
    type: SET_OVERRIDE,
    domain: longHostname,
    action: "block",
  });
  await current.protocol.navigate(current.controlTab, `${optionsUrl}?reset-rule`);
  await waitForOptionsPage(current, {
    include: [longHostname, "Reset saved rules…"],
  });
  checkpoint("options render a complete long hostname");

  const narrowFrameId = "trackerblocker-options-narrow-frame";
  await current.protocol.evaluateJson(
    current.controlTab,
    `(() => {
      const frame = document.createElement("iframe");
      frame.id = ${JSON.stringify(narrowFrameId)};
      frame.src = ${JSON.stringify(`${optionsUrl}?narrow`)};
      frame.title = "Narrow settings test viewport";
      frame.style.border = "0";
      frame.style.display = "block";
      frame.style.height = "700px";
      frame.style.width = "320px";
      document.body.append(frame);
      return true;
    })()`,
  );
  const narrowPage = await waitForOptionsPage(
    current,
    { include: [longHostname] },
    current.controlTab,
    narrowFrameId,
  );
  assert(narrowPage.viewportWidth <= 320);
  assert(narrowPage.scrollWidth <= narrowPage.viewportWidth);
  assert.equal(narrowPage.hostnames[0]?.text, longHostname);
  assert.equal(narrowPage.hostnames[0]?.overflowWrap, "anywhere");
  checkpoint("options remain readable at 320 pixels");
  await current.protocol.evaluateJson(
    current.controlTab,
    `(() => {
      document.getElementById(${JSON.stringify(narrowFrameId)})?.remove();
      return true;
    })()`,
  );
  const focusResults = await inspectOptionsButtonFocus(
    current,
    current.controlTab,
  );
  assert(focusResults.length >= 2);
  assert(focusResults.every(({ focused }) => focused));
  assert(
    focusResults.every(({ hasVisibleFocusRule }) => hasVisibleFocusRule),
    `Expected packaged options focus styles: ${JSON.stringify(focusResults)}`,
  );
  checkpoint("options mutation controls accept visible focus");

  await clickButton(current, "Reset saved rules…");
  await waitForOptionsPage(current, {
    include: [
      "Reset all saved rules?",
      "Always-paused sites.",
      "Site-specific hostname allows.",
      "Global hostname overrides.",
      "Tab-scoped “pause once” state is not part of saved rules and is unaffected.",
    ],
  });
  await clickButton(current, "Cancel");
  await waitForOptionsPage(current, {
    include: [longHostname],
    exclude: ["Reset all saved rules?"],
  });
  settings = await sendMessage(current, { type: GET_SETTINGS });
  assert.deepEqual(settings.domainOverrides, {
    [longHostname]: "block",
  });
  checkpoint("options reset confirmation cancels without changing storage");

  await clickButton(current, "Reset saved rules…");
  await clickButton(current, "Reset saved rules");
  const resetPage = await waitForOptionsPage(current, {
    activeElementText: "Saved rules were reset.",
    include: [
      "Saved rules were reset.",
      "No always-paused sites.",
      "No site-specific hostname allows.",
      "No hostname overrides.",
    ],
    exclude: ["Reset all saved rules?", longHostname],
  });
  settings = await sendMessage(current, { type: GET_SETTINGS });
  assert.deepEqual(settings.pausedSites, {});
  assert.deepEqual(settings.siteAllows, {});
  assert.deepEqual(settings.domainOverrides, {});
  assert.equal(
    resetPage.buttons.find(({ text }) => text === "Reset saved rules…")
      ?.disabled,
    true,
  );
  assert.equal(resetPage.activeElementText, "Saved rules were reset.");
  checkpoint("options confirmed reset clears rules and reports completion");
}

async function getCurrentSummary(current) {
  return sendMessage(current, {
    type: GET_SUMMARY,
    tabId: current.fixtureBrowserTabId,
    pageUrl: current.lastProbeUrl,
  });
}

async function getBadgePresentation(
  current,
  tabId = current.fixtureBrowserTabId,
) {
  return current.protocol.evaluateJson(
    current.controlTab,
    `({
      text: await browser.action.getBadgeText({ tabId: ${tabId} }),
      title: await browser.action.getTitle({ tabId: ${tabId} }),
    })`,
  );
}

async function readPopupProtection(current) {
  return current.protocol.evaluateJson(
    current.controlTab,
    `(async () => {
      await browser.tabs.update(${current.fixtureBrowserTabId}, { active: true });
      await browser.action.openPopup();
      let last = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const popup = browser.extension.getViews({ type: "popup" })[0];
        if (popup) {
          last = {
            value: popup.document.querySelector(".tb-metric-value")?.textContent?.trim() ?? null,
            label: popup.document.querySelector(".tb-metric-label")?.textContent?.trim() ?? null,
          };
          if (last.label && last.label !== "Checking blocked count") {
            popup.close();
            return last;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error("Popup did not render: " + JSON.stringify(last));
    })()`,
  );
}

async function switchAwayAndBack(current) {
  const browserTabs = await current.protocol.evaluateJson(
    current.controlTab,
    "browser.tabs.query({})",
  );
  const controlBrowserTab = browserTabs.find(
    ({ id }) => id !== current.fixtureBrowserTabId,
  );
  assert(controlBrowserTab);
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.update(${controlBrowserTab.id}, { active: true }), true)`,
  );
  await delay(50);
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.tabs.update(${current.fixtureBrowserTabId}, { active: true }), true)`,
  );
  const fixtureTab = browserTabs.find(
    ({ id }) => id === current.fixtureBrowserTabId,
  );
  assert(fixtureTab);
  const otherWindow = await current.protocol.evaluateJson(
    current.controlTab,
    "browser.windows.create({ url: 'about:blank', focused: true })",
  );
  await delay(50);
  await current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.windows.update(${fixtureTab.windowId}, { focused: true }), await browser.windows.remove(${otherWindow.id}), true)`,
  );
}

async function terminateBackground(current) {
  await withTimeout(
    current.remote.client.request({
      to: current.addon.actor,
      type: "terminateBackgroundScript",
    }),
    10_000,
    "Background did not terminate in time.",
  );
}

async function getStoredSessionState(current) {
  const stored = await current.protocol.evaluateJson(
    current.controlTab,
    "browser.storage.session.get('trackerblocker:session-state')",
  );
  return stored["trackerblocker:session-state"];
}

async function setStoredSessionState(current, state) {
  return current.protocol.evaluateJson(
    current.controlTab,
    `(await browser.storage.session.set({
      "trackerblocker:session-state": ${JSON.stringify(state)},
    }), true)`,
  );
}

async function supportsNativeDocumentIds(current) {
  return current.protocol.evaluateJson(
    current.controlTab,
    `(async () => {
      const frame = await browser.webNavigation.getFrame({
        tabId: ${current.fixtureBrowserTabId},
        frameId: 0,
      });
      return typeof frame?.documentId === "string" && frame.documentId.length > 0;
    })()`,
  );
}

async function waitForLedgerRemoval(current, tabId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const session = await getStoredSessionState(current);
    if (!(String(tabId) in session.enforcementLedger)) {
      return;
    }
    await delay(25);
  }
  throw new Error(`Ledger state for closed tab ${tabId} was not removed.`);
}

async function runProbe(current, url) {
  const probeUrl = new URL(url);
  probeUrl.searchParams.set("__qa", String(++probeSequence));
  current.lastProbeUrl = probeUrl.href;
  await current.protocol.navigate(current.fixtureTab, current.lastProbeUrl);
  return current.protocol.waitForFixture(current.fixtureTab);
}

async function sendMessage(current, message) {
  return current.protocol.evaluateJson(
    current.controlTab,
    `browser.runtime.sendMessage(${JSON.stringify(message)})`,
  );
}

async function waitForBackground(protocol, controlTab) {
  let last;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      last = await protocol.evaluateJson(
        controlTab,
        `browser.runtime.sendMessage({ type: ${JSON.stringify(HEALTH)} })`,
      );
      if (
        last?.easyPrivacy?.engineHealth === EXPECTED_ENGINE_HEALTH &&
        last?.settings?.health === "ready"
      ) {
        return last;
      }
    } catch {
      // Temporary extension or restarted worker is still starting.
    }
    await delay(50);
  }
  throw new Error(`Background did not become healthy: ${JSON.stringify(last)}`);
}

async function waitForPauseRemoval(current, tabId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const stored = await current.protocol.evaluateJson(
      current.controlTab,
      "browser.storage.session.get('trackerblocker:session-state')",
    );
    if (
      !(String(tabId) in stored["trackerblocker:session-state"].temporarySitePauses)
    ) {
      return;
    }
    await delay(25);
  }
  throw new Error(`Pause state for closed tab ${tabId} was not removed.`);
}

async function waitForBrowserTab(current, tabId, url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const browserTab = await current.protocol.evaluateJson(
      current.controlTab,
      `browser.tabs.get(${tabId})`,
    );
    const tabs = (await current.remote.client.request("listTabs")).tabs ?? [];
    const rdpTab = tabs.find((candidate) => candidate.url === url);
    if (browserTab.url === url && browserTab.status === "complete" && rdpTab) {
      return rdpTab;
    }
    await delay(25);
  }
  throw new Error(`Tab ${tabId} did not finish ${url}.`);
}

async function clickButton(current, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const clicked = await current.protocol.evaluateJson(
      current.controlTab,
      `(() => {
        const button = [...document.querySelectorAll("button")]
          .find(candidate => candidate.textContent?.trim() === ${JSON.stringify(label)});
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`,
    );
    if (clicked) {
      await delay(100);
      return;
    }
    await delay(25);
  }
  throw new Error(`Options button ${label} was unavailable.`);
}

async function waitForOptionsPage(
  current,
  { activeElementText = null, include = [], exclude = [] },
  tab = current.controlTab,
  frameId = null,
) {
  let state;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      state = await readOptionsPage(current, tab, frameId);
      if (
        include.every((text) => state.allText.includes(text)) &&
        exclude.every((text) => !state.allText.includes(text)) &&
        (activeElementText === null ||
          state.activeElementText === activeElementText)
      ) {
        return state;
      }
    } catch {
      // The options document may still be replacing its frame actor.
    }
    await delay(25);
  }
  throw new Error(
    `Options page did not reach the expected state: ${JSON.stringify({
      include,
      exclude,
      activeElementText,
      state,
    })}`,
  );
}

function readOptionsPage(current, tab, frameId) {
  return current.protocol.evaluateJson(
    tab,
    `(() => {
      const pageDocument = ${
        frameId
          ? `document.getElementById(${JSON.stringify(frameId)})?.contentDocument`
          : "document"
      };
      if (!pageDocument?.body || !pageDocument.defaultView) {
        return {
          allText: "",
          activeElementText: "",
          busy: null,
          buttons: [],
          documentTitle: "",
          hostnames: [],
          scrollWidth: 0,
          viewportWidth: 0,
        };
      }
      const management = pageDocument.querySelector('[aria-label="Saved rules management"]');
      return {
        allText: pageDocument.body.textContent ?? "",
        activeElementText: pageDocument.activeElement?.textContent?.trim() ?? "",
        busy: management?.getAttribute("aria-busy") ?? null,
        buttons: [...pageDocument.querySelectorAll("button")].map(button => ({
          ariaLabel: button.getAttribute("aria-label"),
          disabled: button.disabled,
          text: button.textContent?.trim() ?? "",
        })),
        documentTitle: pageDocument.title,
        hostnames: [...pageDocument.querySelectorAll(".settings-hostname")].map(element => {
          const style = pageDocument.defaultView.getComputedStyle(element);
          return {
            overflowWrap: style.overflowWrap,
            text: element.textContent?.trim() ?? "",
          };
        }),
        scrollWidth: pageDocument.documentElement.scrollWidth,
        viewportWidth: pageDocument.documentElement.clientWidth,
      };
    })()`,
  );
}

function inspectOptionsButtonFocus(current, tab, frameId = null) {
  return current.protocol.evaluateJson(
    tab,
    `(() => {
      const pageDocument = ${
        frameId
          ? `document.getElementById(${JSON.stringify(frameId)})?.contentDocument`
          : "document"
      };
      if (!pageDocument?.defaultView) return [];
      pageDocument.defaultView.focus();
      const hasVisibleFocusRule = [...pageDocument.styleSheets].some(sheet => {
        function findRule(rules) {
          return [...rules].some(rule => {
            if (
              rule.selectorText === "button:focus" &&
              rule.style?.outlineStyle === "solid" &&
              Number.parseFloat(rule.style.outlineWidth) > 0
            ) {
              return true;
            }
            return rule.cssRules ? findRule(rule.cssRules) : false;
          });
        }
        return findRule(sheet.cssRules);
      });
      return [...pageDocument.querySelectorAll("button")]
      .filter(button => !button.disabled)
      .map(button => {
        button.focus();
        return {
          focused: pageDocument.activeElement === button,
          hasVisibleFocusRule,
          text: button.textContent?.trim() ?? "",
        };
      });
    })()`,
  );
}

class FirefoxProtocol {
  constructor(client) {
    this.client = client;
    this.buffered = new Map();
    this.pending = new Map();
    const original = client._handleMessage.bind(client);
    client._handleMessage = (message) => {
      if (message.type !== "evaluationResult") return original(message);
      const pending = this.pending.get(message.resultID);
      if (pending) {
        this.pending.delete(message.resultID);
        pending.resolve(message);
      } else {
        this.buffered.set(message.resultID, message);
      }
    };
  }

  async navigate(tab, url) {
    await this.client.request({
      to: tab.actor,
      type: "navigateTo",
      url,
      waitForLoad: false,
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const target = await this.client.request({ to: tab.actor, type: "getTarget" });
        if (target.frame.url === url) return;
      } catch {
        // Target actor may be switching during navigation.
      }
      await delay(25);
    }
    throw new Error(`Firefox did not navigate to ${url}.`);
  }

  async evaluateJson(tab, expression) {
    const value = await this.evaluate(
      tab,
      `(async () => JSON.stringify(await (${expression})))()`,
    );
    if (typeof value !== "string") {
      throw new Error(`Expected JSON string, got ${JSON.stringify(value)}.`);
    }
    return JSON.parse(value);
  }

  async evaluate(tab, text) {
    const target = await this.client.request({ to: tab.actor, type: "getTarget" });
    const started = await this.client.request({
      to: target.frame.consoleActor,
      type: "evaluateJSAsync",
      text,
      mapped: { await: true },
    });
    const result = await this.waitForEvaluation(started.resultID);
    if (result.hasException) {
      throw new Error(result.exceptionMessage ?? "Firefox evaluation failed.");
    }
    if (result.result?.type === "longString") {
      const response = await this.client.request({
        to: result.result.actor,
        type: "substring",
        start: 0,
        end: result.result.length,
      });
      return response.substring;
    }
    return decodeGrip(result.result);
  }

  async waitForFixture(tab) {
    let state;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        state = await this.evaluateJson(tab, `({
          complete: document.documentElement.dataset.fixtureComplete === "true",
          results: document.querySelector("#results")?.textContent ?? null,
        })`);
        if (state.complete) return JSON.parse(state.results);
      } catch {
        // The frame actor can be replaced between navigation and evaluation.
      }
      await delay(50);
    }
    throw new Error(`Fixture did not complete: ${JSON.stringify(state)}`);
  }

  waitForEvaluation(resultID) {
    const buffered = this.buffered.get(resultID);
    if (buffered) {
      this.buffered.delete(resultID);
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(resultID);
        reject(new Error(`Timed out waiting for evaluation ${resultID}.`));
      }, 10_000);
      this.pending.set(resultID, {
        resolve(value) {
          clearTimeout(timeout);
          resolve(value);
        },
      });
    });
  }
}

async function findAddon(remote) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await remote.client.request("listAddons");
    const addon = response.addons.find(({ id }) => id === EXTENSION_ID);
    if (addon) return addon;
    await delay(50);
  }
  throw new Error(`Firefox did not install ${EXTENSION_ID}.`);
}

async function waitForTabs(remote, expectedUrls) {
  let tabs = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    tabs = (await remote.client.request("listTabs")).tabs;
    if (expectedUrls.every((url) => tabs.some((tab) => tab.url === url))) {
      return tabs;
    }
    await delay(50);
  }
  throw new Error(`Expected tabs ${JSON.stringify(expectedUrls)}; saw ${JSON.stringify(tabs.map(({ url }) => url))}.`);
}

function createQaPreferences() {
  return {
    "app.update.disabledForTesting": true,
    "browser.safebrowsing.downloads.enabled": false,
    "browser.safebrowsing.malware.enabled": false,
    "browser.safebrowsing.phishing.enabled": false,
    "browser.shell.checkDefaultBrowser": false,
    "datareporting.healthreport.uploadEnabled": false,
    "dom.security.https_only_mode": false,
    "extensions.getAddons.cache.enabled": false,
    "network.captive-portal-service.enabled": false,
    "network.connectivity-service.enabled": false,
    "network.dns.localDomains": FIREFOX_FIXTURE_HOSTS.join(","),
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": fixture.port,
    "network.proxy.no_proxies_on": "",
    "network.proxy.share_proxy_settings": true,
    "network.proxy.type": 1,
    "network.stricttransportsecurity.preloadlist": false,
    "toolkit.telemetry.enabled": false,
    "toolkit.telemetry.unified": false,
  };
}

async function verifyBuild() {
  const manifest = JSON.parse(
    await readFile(path.join(EXTENSION_SOURCE, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.name, EXTENSION_NAME);
  assert.equal(manifest.browser_specific_settings?.gecko?.id, EXTENSION_ID);
}

async function resolveFirefoxBinary() {
  if (process.env.FIREFOX_BINARY) {
    await access(process.env.FIREFOX_BINARY);
    return process.env.FIREFOX_BINARY;
  }
  const mac = "/Applications/Firefox.app/Contents/MacOS/firefox";
  try {
    await access(mac);
    return mac;
  } catch {
    return undefined;
  }
}

function report() {
  const unexpected = fixture.requests.filter(
    ({ host, method }) =>
      (!FIREFOX_FIXTURE_HOSTS.includes(host) && host !== "127.0.0.1") ||
      (method !== "GET" && method !== "UPGRADE"),
  );
  assert.deepEqual(unexpected, []);
  checkpoint("captured browser traffic remained confined to local fixtures");
  process.stdout.write("\nEasyPrivacy Firefox integration report\n");
  process.stdout.write(`Firefox binary: ${FIREFOX_BINARY ?? "system default"}\n`);
  process.stdout.write(`Fixture requests served locally: ${fixture.requests.length}\n`);
  process.stdout.write(`Checkpoints passed: ${checkpoints.length}\n`);
  for (const name of checkpoints) process.stdout.write(`- ${name}\n`);
}

function checkpoint(name) {
  checkpoints.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

function decodeGrip(grip) {
  return grip && typeof grip === "object" && "value" in grip ? grip.value : grip;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

await main();
