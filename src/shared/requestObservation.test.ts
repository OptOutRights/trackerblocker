import { describe, expect, it } from "vitest";

import {
  MAX_ACTIVE_REQUESTS_GLOBAL,
  MAX_ACTIVE_REQUESTS_PER_TAB,
  MAX_HOST_ROWS_PER_TAB,
  createTabObservationState,
  enforceGlobalActiveRequestLimit,
  getActiveRequestAttempt,
  getActiveRequestDecision,
  formatPrivacySafePathHint,
  mapRequestType,
  recordObservedRequest,
  recordRequestCompleted,
  recordRequestFailed,
  recordRequestRedirect,
  recordUnobservedRequestAttempt,
  resetTabObservationState,
  summarizeHostRequestDetails,
  summarizeTabObservation,
} from "./requestObservation";
import type {
  RequestAction,
  RequestDecision,
  RequestDecisionSource,
} from "./requestDecisions";
import type { TrackerCatalogEntry } from "./trackerCatalog";
import type { FilterRuleEvidence } from "./filterEngine";

function ruleEvidence(key: string): FilterRuleEvidence {
  return {
    key,
    engineId: key.split(":").at(-1) ?? key,
    normalizedSummary: "||mixed.test/collect^",
    requestTypes: ["xhr"],
    partyScope: "third-party",
    sourceConstraint: "none",
  };
}

function requestDecision(
  requestId: string,
  tabId: number,
  action: RequestAction,
  source: RequestDecisionSource,
  evidence: Partial<
    Pick<RequestDecision, "matchedFilter" | "matchedException">
  > = {},
): RequestDecision {
  return {
    requestId,
    tabId,
    action,
    source,
    reason:
      source === "easyprivacy"
        ? action === "allow"
          ? "easyprivacy-exception"
          : "easyprivacy-block"
        : source === "user-block"
          ? "global-user-block"
          : source === "site-pause"
            ? "site-paused"
            : "no-supported-match",
    easyPrivacyEvaluation:
      source === "easyprivacy"
        ? action === "allow"
          ? "exception"
          : "block"
        : "not-evaluated",
    relationship: "third-party",
    requestHost: "mixed.test",
    matchedFilter: null,
    matchedException: null,
    catalogMatch: null,
    headerRestriction: null,
    ...evidence,
  };
}

describe("mapRequestType", () => {
  it("maps WebExtension request types to popup categories", () => {
    expect(mapRequestType("script")).toBe("script");
    expect(mapRequestType("image")).toBe("image");
    expect(mapRequestType("sub_frame")).toBe("iframe");
    expect(mapRequestType("xmlhttprequest")).toBe("xhr");
    expect(mapRequestType("beacon")).toBe("beacon");
    expect(mapRequestType("ping")).toBe("beacon");
    expect(mapRequestType("stylesheet")).toBe("stylesheet");
    expect(mapRequestType("websocket")).toBe("websocket");
    expect(mapRequestType("font")).toBe("font");
    expect(mapRequestType("media")).toBe("media");
    expect(mapRequestType("object")).toBe("object");
    expect(mapRequestType("object_subrequest")).toBe("object");
    expect(mapRequestType("manifest")).toBe("manifest");
    expect(mapRequestType("speculative")).toBe("prefetch");
    expect(mapRequestType("preload")).toBe("prefetch");
    expect(mapRequestType("prefetch")).toBe("prefetch");
    expect(mapRequestType()).toBe("other");
  });
});

describe("request observation aggregation", () => {
  it("aggregates third-party requests by hostname while preserving site metadata", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://cdn.tracker.test/script.js",
      requestType: "script",
      timestamp: 100,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://img.tracker.test/pixel.png",
      requestType: "image",
      timestamp: 200,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      requestCounts: { total: 2, blocked: 0, restricted: 0, allowed: 2 },
      hostCounts: { thirdParty: 2, unknown: 2, firstParty: 0 },
      rows: [
        {
          host: "cdn.tracker.test",
          siteDomain: "tracker.test",
          displayName: "cdn.tracker.test",
          relationship: "third-party",
          requestCount: 1,
          requestTypes: ["script"],
          category: "unknown",
          entity: null,
          catalogDefaultAction: null,
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
          sourceCounts: { default: 1 },
          firstSeen: 100,
          lastSeen: 100,
          lifecycle: {
            started: 1,
            completed: 0,
            blocked: 0,
            failed: 0,
            redirected: 0,
          },
          context: {
            frameIds: [0],
            documentHosts: [],
            initiatorHosts: [],
            pathHints: [],
            visibilityNotes: ["visible-request"],
          },
          redirectHops: [],
        },
        {
          host: "img.tracker.test",
          siteDomain: "tracker.test",
          displayName: "img.tracker.test",
          relationship: "third-party",
          requestCount: 1,
          requestTypes: ["image"],
          category: "unknown",
          entity: null,
          catalogDefaultAction: null,
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
          sourceCounts: { default: 1 },
        },
      ],
    });
  });

  it("adds local catalog details to known third-party rows", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://www.google-analytics.com/analytics.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 1, blocked: 1 },
      rows: [
        {
          host: "www.google-analytics.com",
          siteDomain: "google-analytics.com",
          displayName: "www.google-analytics.com",
          relationship: "third-party",
          category: "analytics",
          entity: "Google",
          catalogDefaultAction: "block",
          explanation:
            "This domain is commonly used to measure visits, page views, and user interactions.",
          actionCounts: { total: 1, blocked: 1, restricted: 0, allowed: 0 },
          sourceCounts: { catalog: 1 },
        },
      ],
    });
  });

  it("summarizes restricted catalog rows separately from blocked and allowed rows", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://o123.ingest.sentry.io/api/1/envelope/",
      requestType: "xmlhttprequest",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      requestCounts: { total: 1, blocked: 0, restricted: 1, allowed: 0 },
      hostCounts: { blocked: 0, restricted: 1, allowed: 0 },
      rows: [
        {
          displayName: "o123.ingest.sentry.io",
          category: "observability",
          entity: "Sentry",
          catalogDefaultAction: "restrict",
          catalogSource: null,
          catalogConfidence: null,
          catalogBreakageRisk: "low",
          actionCounts: { total: 1, blocked: 0, restricted: 1, allowed: 0 },
        },
      ],
    });
  });

  it("applies per-domain allow overrides to catalog-blocked rows", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://www.google-analytics.com/analytics.js",
      requestType: "script",
      timestamp: 100,
      domainOverrides: {
        "www.google-analytics.com": "allow",
      },
    });

    expect(
      summarizeTabObservation(state, {
        domainOverrides: {
          "www.google-analytics.com": "allow",
        },
      }),
    ).toMatchObject({
      requestCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
      rows: [
        {
          displayName: "www.google-analytics.com",
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
          sourceCounts: { "user-allow": 1 },
          currentOverride: "allow",
        },
      ],
    });
  });

  it("lets site pause allow catalog-blocked rows", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://www.google-analytics.com/analytics.js",
      requestType: "script",
      timestamp: 100,
      sitePaused: true,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      requestCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
      rows: [
        {
          displayName: "www.google-analytics.com",
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
          sourceCounts: { "site-pause": 1 },
        },
      ],
    });
  });

  it("keeps observed decisions immutable while exposing the current override", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://www.google-analytics.com/analytics.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(
      summarizeTabObservation(state, {
        domainOverrides: {
          "www.google-analytics.com": "allow",
        },
      }),
    ).toMatchObject({
      requestCounts: { total: 1, blocked: 1, restricted: 0, allowed: 0 },
      rows: [
        {
          displayName: "www.google-analytics.com",
          actionCounts: { total: 1, blocked: 1, restricted: 0, allowed: 0 },
          sourceCounts: { catalog: 1 },
          currentOverride: "allow",
        },
      ],
    });
  });

  it("overlays only the exact current-site allow without rewriting history", () => {
    const state = createTabObservationState(1, "https://publisher.test/page");
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://www.google-analytics.com/analytics.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(
      summarizeTabObservation(state, {
        siteAllows: {
          "publisher.test": { "www.google-analytics.com": true },
          "other.test": { "unrelated.test": true },
        },
      }),
    ).toMatchObject({
      requestCounts: { blocked: 1, allowed: 0 },
      rows: [
        {
          currentSiteAllow: true,
          actionCounts: { blocked: 1, allowed: 0 },
        },
      ],
    });
  });

  it("uses the most specific local catalog match for host-level rows", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://cdnjs.cloudflare.com/ajax/libs/app.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      requestCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
      rows: [
        {
          displayName: "cdnjs.cloudflare.com",
          siteDomain: "cloudflare.com",
          category: "cdn",
          entity: "Cloudflare",
          catalogDefaultAction: "allow",
          explanation:
            "This domain is commonly used to load shared JavaScript or CSS libraries from a CDN.",
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
        },
      ],
    });
  });

  it("keeps confirmed third-party rows before unknown and first-party rows", () => {
    const state = createTabObservationState(1, "https://www.example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://static.example.com/app.js",
      requestType: "script",
      timestamp: 100,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "data:text/plain,hello",
      requestType: "image",
      timestamp: 200,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://tracker.test/script.js",
      requestType: "script",
      timestamp: 300,
    });

    expect(
      summarizeTabObservation(state).rows.map((row) => row.relationship),
    ).toEqual(["third-party", "unknown", "first-party"]);
  });

  it("uses public suffix aware classification for first-party rows", () => {
    const state = createTabObservationState(1, "https://shop.example.co.uk");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://cdn.example.co.uk/image.png",
      requestType: "image",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 0, unknown: 0, firstParty: 1 },
      requestCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
      rows: [
        {
          host: "cdn.example.co.uk",
          siteDomain: "example.co.uk",
          displayName: "cdn.example.co.uk",
          relationship: "first-party",
        },
      ],
    });
  });

  it("classifies frame-owned requests against the top-level page site", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 12,
      parentFrameId: 0,
      pageUrl: "https://frame.tracker.test/embed",
      documentUrl: "https://frame.tracker.test/embed",
      requestUrl: "https://frame.tracker.test/app.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 1, firstParty: 0 },
      rows: [
        {
          host: "frame.tracker.test",
          siteDomain: "tracker.test",
          displayName: "frame.tracker.test",
          relationship: "third-party",
          context: {
            frameContexts: [
              {
                frameId: 12,
                parentFrameId: 0,
                frameHost: "frame.tracker.test",
                documentHost: "frame.tracker.test",
                relationship: "third-party",
              },
            ],
          },
        },
      ],
    });
  });

  it("preserves frame ancestry for embedded documents and their requests", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 4,
      parentFrameId: 0,
      pageUrl: "https://example.com",
      documentUrl: "https://example.com",
      requestUrl: "https://pay.example-payments.test/checkout",
      requestType: "sub_frame",
      timestamp: 100,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 4,
      parentFrameId: 0,
      pageUrl: "https://example.com",
      documentUrl: "https://pay.example-payments.test/checkout",
      requestUrl: "https://cdn.example-payments.test/sdk.js",
      requestType: "script",
      timestamp: 120,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 2 },
      rows: [
        {
          displayName: "cdn.example-payments.test",
          context: {
            frameContexts: [
              {
                frameId: 4,
                parentFrameId: 0,
                frameHost: "pay.example-payments.test",
                documentHost: "pay.example-payments.test",
                relationship: "third-party",
              },
            ],
            visibilityNotes: ["frame-ancestry-limited", "visible-request"],
          },
        },
        {
          displayName: "pay.example-payments.test",
          requestTypes: ["iframe"],
          context: {
            frameContexts: [
              {
                frameId: 4,
                parentFrameId: 0,
                frameHost: "pay.example-payments.test",
                documentHost: "example.com",
                relationship: "third-party",
              },
            ],
          },
        },
      ],
    });
  });

  it("aggregates third-party WebSocket requests", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "wss://events.tracker.test/socket",
      requestType: "websocket",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 1 },
      rows: [
        {
          host: "events.tracker.test",
          siteDomain: "tracker.test",
          displayName: "events.tracker.test",
          relationship: "third-party",
          requestTypes: ["websocket"],
          context: {
            visibilityNotes: [
              "visible-request",
              "websocket-frames-not-classified",
            ],
          },
        },
      ],
    });
  });

  it("collects local evidence without storing request query strings", () => {
    const state = createTabObservationState(1, "https://example.com/page");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 3,
      parentFrameId: 0,
      pageUrl: "https://example.com/page",
      documentUrl: "https://widgets.example-frame.test/embed",
      originUrl: "https://example.com/page",
      initiator: "https://widgets.example-frame.test/embed",
      requestUrl:
        "https://analytics.tracker.test/v1/collect/pixel?email=user@example.com",
      requestType: "xmlhttprequest",
      timestamp: 100,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 3,
      pageUrl: "https://example.com/page",
      documentUrl: "https://widgets.example-frame.test/embed",
      originUrl: "https://example.com/page",
      requestUrl: "https://analytics.tracker.test/v1/events",
      requestType: "beacon",
      timestamp: 200,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { thirdParty: 1 },
      requestCounts: { total: 2, blocked: 0, restricted: 0, allowed: 2 },
      rows: [
        {
          displayName: "analytics.tracker.test",
          firstSeen: 100,
          lastSeen: 200,
          requestTypes: ["beacon", "xhr"],
          lifecycle: {
            started: 2,
            completed: 0,
            blocked: 0,
            failed: 0,
            redirected: 0,
          },
          context: {
            frameIds: [3],
            documentHosts: ["example.com", "widgets.example-frame.test"],
            initiatorHosts: ["example.com", "widgets.example-frame.test"],
            pathHints: ["collect", "event", "events", "pixel"],
            visibilityNotes: [
              "exit-beacon-may-be-missed",
              "frame-ancestry-limited",
              "headers-not-inspected",
              "visible-request",
            ],
          },
        },
      ],
    });

    const row = summarizeTabObservation(state).rows[0];
    expect(JSON.stringify(row)).not.toContain("user@example.com");
  });

  it("tracks request lifecycle by request id", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      requestId: "request-1",
      tabId: 1,
      frameId: 0,
      requestUrl: "https://tracker.test/script.js",
      requestType: "script",
      timestamp: 100,
    });
    recordRequestCompleted(state, {
      requestId: "request-1",
      timestamp: 150,
    });
    recordRequestFailed(state, {
      requestId: "request-1",
      timestamp: 200,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      rows: [
        {
          displayName: "tracker.test",
          lastSeen: 150,
          lifecycle: {
            started: 1,
            completed: 1,
            blocked: 0,
            failed: 0,
            redirected: 0,
          },
        },
      ],
    });
  });

  it("keeps terminal failures tied to the individual request decision", () => {
    const state = createTabObservationState(1, "https://example.com");
    const requestUrl = "https://www.google-analytics.com/analytics.js";

    recordObservedRequest(state, {
      requestId: "blocked-request",
      tabId: 1,
      frameId: 0,
      requestUrl,
      requestType: "script",
      timestamp: 100,
    });
    recordRequestFailed(state, {
      requestId: "blocked-request",
      timestamp: 110,
    });
    recordObservedRequest(state, {
      requestId: "allowed-request",
      tabId: 1,
      frameId: 0,
      requestUrl,
      requestType: "script",
      timestamp: 120,
      domainOverrides: {
        "www.google-analytics.com": "allow",
      },
    });
    recordRequestFailed(state, {
      requestId: "allowed-request",
      timestamp: 130,
    });

    expect(summarizeTabObservation(state).rows[0].lifecycle).toMatchObject({
      started: 2,
      blocked: 1,
      failed: 1,
    });
  });

  it("aggregates path actions without changing the current request decision", () => {
    const state = createTabObservationState(1, "https://example.com");
    const catalog: TrackerCatalogEntry[] = [
      {
        id: "mixed-cdn",
        matchType: "domain",
        domain: "cdn.example.test",
        entity: "Example CDN",
        category: "cdn",
        defaultAction: "allow",
        explanation: "This domain is commonly used to deliver site assets.",
        rules: [
          {
            id: "collect-endpoint",
            matchType: "path-prefix",
            value: "/collect",
            action: "block",
            explanation: "This path is a confirmed collection endpoint.",
          },
        ],
      },
    ];

    const firstAllowed = recordObservedRequest(
      state,
      {
        requestId: "asset-1",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://cdn.example.test/app.js",
        requestType: "script",
        timestamp: 100,
      },
      { catalog },
    );
    const blocked = recordObservedRequest(
      state,
      {
        requestId: "collect-1",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://cdn.example.test/collect/event",
        requestType: "beacon",
        timestamp: 110,
      },
      { catalog },
    );
    const laterAllowed = recordObservedRequest(
      state,
      {
        requestId: "asset-2",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://cdn.example.test/image.png",
        requestType: "image",
        timestamp: 120,
      },
      { catalog },
    );

    expect(firstAllowed.shouldBlock).toBe(false);
    expect(blocked.shouldBlock).toBe(true);
    expect(laterAllowed.shouldBlock).toBe(false);
    expect(summarizeTabObservation(state).rows[0]).toMatchObject({
      catalogDefaultAction: "block",
      catalogRuleIds: ["collect-endpoint"],
      actionCounts: { total: 3, blocked: 1, restricted: 0, allowed: 2 },
      sourceCounts: { catalog: 3 },
      isMixed: true,
      lifecycle: {
        started: 3,
        blocked: 1,
      },
    });
  });

  it("records sanitized redirect hops without full URLs", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      requestId: "redirecting-request",
      tabId: 1,
      frameId: 0,
      requestUrl: "https://ads.example.test/click?id=user-123",
      requestType: "main_frame",
      timestamp: 100,
    });
    recordRequestRedirect(state, {
      requestId: "redirecting-request",
      fromUrl: "https://ads.example.test/click?id=user-123",
      redirectUrl: "https://measure.example.test/next?email=user@example.com",
      statusCode: 302,
      timestamp: 125,
    });

    const row = summarizeTabObservation(state).rows[0];

    expect(row).toMatchObject({
      lifecycle: {
        started: 1,
        completed: 0,
        blocked: 0,
        failed: 0,
        redirected: 1,
      },
      redirectHops: [
        {
          fromHost: "ads.example.test",
          toHost: "measure.example.test",
          statusCode: 302,
          timestamp: 125,
        },
      ],
    });
    expect(JSON.stringify(row)).not.toContain("user@example.com");
    expect(JSON.stringify(row)).not.toContain("user-123");
  });

  it("bounds redirect evidence and marks the truncation", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      requestId: "redirecting-request",
      tabId: 1,
      frameId: 0,
      requestUrl: "https://redirect.test/start",
      requestType: "xmlhttprequest",
      timestamp: 100,
    });

    for (let index = 0; index < 10; index += 1) {
      recordRequestRedirect(state, {
        requestId: "redirecting-request",
        fromUrl: `https://redirect-${index}.test/start`,
        redirectUrl: `https://redirect-${index + 1}.test/next`,
        statusCode: 302,
        timestamp: 101 + index,
      });
    }

    const row = summarizeTabObservation(state).rows[0];
    expect(row.redirectHops).toHaveLength(8);
    expect(row.redirectEvidenceTruncated).toBe(true);
    expect(row.lifecycle.redirected).toBe(10);
  });

  it("caps explanatory context while keeping exact request totals", () => {
    const state = createTabObservationState(1, "https://example.com");

    for (let index = 0; index < 20; index += 1) {
      recordObservedRequest(state, {
        tabId: 1,
        frameId: index + 1,
        parentFrameId: 0,
        pageUrl: "https://example.com",
        documentUrl: `https://frame-${index}.example-frame.test/embed`,
        initiator: `https://initiator-${index}.example-frame.test/script`,
        requestUrl: "https://analytics.tracker.test/collect",
        requestType: "xmlhttprequest",
        timestamp: 100 + index,
      });
    }

    const summary = summarizeTabObservation(state);
    const row = summary.rows[0];

    expect(summary.requestCounts.total).toBe(20);
    expect(row.requestCount).toBe(20);
    expect(row.context.frameIds).toHaveLength(16);
    expect(row.context.frameContexts).toHaveLength(16);
    expect(row.context.documentHosts).toHaveLength(16);
    expect(row.context.initiatorHosts).toHaveLength(16);
    expect(row.context.visibilityNotes).toContain("evidence-truncated");
  });

  it("keeps unclassifiable requests in the unknown bucket", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https:///script.js",
      requestType: "script",
      timestamp: 100,
    });
    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "not a url",
      requestType: "xmlhttprequest",
      timestamp: 200,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { unknown: 1, blocked: 0, allowed: 1 },
      requestCounts: { total: 2, blocked: 0, restricted: 0, allowed: 2 },
      rows: [
        {
          displayName: "Unclassifiable request",
          relationship: "unknown",
          actionCounts: { total: 2, blocked: 0, restricted: 0, allowed: 2 },
          requestCount: 2,
          requestTypes: ["script", "xhr"],
        },
      ],
    });
  });

  it("keeps non-web requests in the unknown bucket", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "moz-extension://extension-id/content.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      hostCounts: { unknown: 1, allowed: 1 },
      requestCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
      rows: [
        {
          displayName: "moz-extension:extension-id",
          relationship: "unknown",
          actionCounts: { total: 1, blocked: 0, restricted: 0, allowed: 1 },
        },
      ],
    });
  });

  it("reports mixed EasyPrivacy decisions and bounded match evidence truthfully", () => {
    const state = createTabObservationState(1, "https://publisher.test");

    for (let index = 0; index < 9; index += 1) {
      recordObservedRequest(
        state,
        {
          requestId: `blocked-${index}`,
          tabId: 1,
          frameId: 0,
          requestUrl: `https://mixed.test/collect/${index}`,
          requestType: "xmlhttprequest",
          timestamp: 100 + index,
        },
        {
          decision: requestDecision(
            `blocked-${index}`,
            1,
            "block",
            "easyprivacy",
            { matchedFilter: ruleEvidence(`easyprivacy:${index}`) },
          ),
        },
      );
    }

    recordObservedRequest(
      state,
      {
        requestId: "excepted",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://mixed.test/asset.js",
        requestType: "script",
        timestamp: 120,
      },
      {
        decision: requestDecision("excepted", 1, "allow", "easyprivacy", {
          matchedFilter: ruleEvidence("easyprivacy:block"),
          matchedException: ruleEvidence("easyprivacy:exception"),
        }),
      },
    );

    const summary = summarizeTabObservation(state);
    expect(summary.requestCounts).toEqual({
      total: 10,
      blocked: 9,
      restricted: 0,
      allowed: 1,
    });
    expect(summary.hostCounts).toMatchObject({
      blocked: 1,
      allowed: 1,
      mixed: 1,
    });
    expect(summary.rows[0]).toMatchObject({
      actionCounts: { total: 10, blocked: 9, restricted: 0, allowed: 1 },
      sourceCounts: { easyprivacy: 10 },
      isMixed: true,
      matchedExceptionKeys: ["easyprivacy:exception"],
      decisionEvidenceTruncated: true,
    });
    expect(summary.rows[0].matchedFilterKeys).toHaveLength(8);
  });

  it("correlates redirect attempts by request id and reuses only the latest decision", () => {
    const state = createTabObservationState(1, "https://publisher.test");
    const first = requestDecision("redirect-id", 1, "allow", "default");
    const second = requestDecision("redirect-id", 1, "block", "user-block");

    recordObservedRequest(
      state,
      {
        requestId: "redirect-id",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://first.test/start",
        requestType: "xmlhttprequest",
        timestamp: 100,
      },
      { decision: first },
    );
    recordRequestRedirect(state, {
      requestId: "redirect-id",
      fromUrl: "https://first.test/start?secret=1",
      redirectUrl: "https://second.test/end?secret=2",
      statusCode: 302,
      timestamp: 110,
    });
    recordObservedRequest(
      state,
      {
        requestId: "redirect-id",
        tabId: 1,
        frameId: 0,
        requestUrl: "https://second.test/end",
        requestType: "xmlhttprequest",
        timestamp: 120,
      },
      { decision: second },
    );

    expect(getActiveRequestAttempt(state, "redirect-id")).toMatchObject({
      attemptIndex: 1,
      decision: second,
    });
    expect(getActiveRequestDecision(state, "redirect-id")).toBe(second);
    expect(summarizeTabObservation(state).requestCounts).toMatchObject({
      total: 2,
      blocked: 1,
      allowed: 1,
    });

    recordRequestCompleted(state, { requestId: "redirect-id", timestamp: 130 });
    expect(getActiveRequestDecision(state, "redirect-id")).toBeNull();
  });

  it("bounds host rows while preserving exact request totals", () => {
    const state = createTabObservationState(1, "https://publisher.test");

    for (let index = 0; index <= MAX_HOST_ROWS_PER_TAB; index += 1) {
      recordObservedRequest(state, {
        requestId: `host-${index}`,
        tabId: 1,
        frameId: 0,
        requestUrl: `https://host-${index}.tracker.test/pixel`,
        requestType: "image",
        timestamp: index,
      });
    }

    const summary = summarizeTabObservation(state);
    expect(summary.rows).toHaveLength(MAX_HOST_ROWS_PER_TAB);
    expect(summary.requestCounts.total).toBe(MAX_HOST_ROWS_PER_TAB + 1);
    expect(summary.hostCounts.lowerBound).toBe(true);
    expect(summary.hostRowsTruncated).toBe(true);
    expect(summary.omittedRequestCount).toBe(1);
  });

  it("bounds active attempts per tab, globally, and by age", () => {
    const states = Array.from({ length: 9 }, (_, tabId) =>
      createTabObservationState(tabId, "https://publisher.test"),
    );

    for (const state of states) {
      for (let index = 0; index < MAX_ACTIVE_REQUESTS_PER_TAB; index += 1) {
        const id = `${state.tabId}-${index}`;
        recordUnobservedRequestAttempt(
          state,
          id,
          requestDecision(id, state.tabId, "allow", "default"),
          index,
        );
      }
    }

    recordUnobservedRequestAttempt(
      states[0],
      "per-tab-overflow",
      requestDecision("per-tab-overflow", 0, "allow", "default"),
      MAX_ACTIVE_REQUESTS_PER_TAB + 1,
    );
    expect(states[0].activeRequests.size).toBe(MAX_ACTIVE_REQUESTS_PER_TAB);
    expect(states[0].activeRequestEvidenceTruncated).toBe(true);

    enforceGlobalActiveRequestLimit(states);
    expect(
      states.reduce((total, state) => total + state.activeRequests.size, 0),
    ).toBe(MAX_ACTIVE_REQUESTS_GLOBAL);
    expect(states.some((state) => state.activeRequestEvidenceTruncated)).toBe(
      true,
    );

    const state = createTabObservationState(99, "https://publisher.test");
    recordUnobservedRequestAttempt(
      state,
      "stale",
      requestDecision("stale", 99, "allow", "default"),
      0,
    );
    recordObservedRequest(state, {
      requestId: "fresh",
      tabId: 99,
      frameId: 0,
      requestUrl: "https://fresh.test/pixel",
      requestType: "image",
      timestamp: 10 * 60 * 1_000 + 1,
    });
    expect(getActiveRequestDecision(state, "stale")).toBeNull();
    expect(state.activeRequestEvidenceTruncated).toBe(true);
  });

  it("keeps bounded, privacy-safe causal samples and rejects stale detail reads", () => {
    const state = createTabObservationState(1, "https://publisher.test/article");

    const requestTypes = [
      "xmlhttprequest",
      "image",
      "script",
      "font",
      "media",
      "websocket",
      "stylesheet",
    ];
    for (let index = 0; index < requestTypes.length; index += 1) {
      recordObservedRequest(
        state,
        {
          requestId: `ordinary-${index}`,
          tabId: 1,
          frameId: 0,
          documentUrl: "https://publisher.test/article",
          requestUrl: `https://mixed.test/collect/${index}?email=person@example.test`,
          requestType: requestTypes[index],
          timestamp: 100 + index,
        },
        {
          decision: requestDecision(
            `ordinary-${index}`,
            1,
            "allow",
            "default",
          ),
        },
      );
    }

    const excepted = recordObservedRequest(
      state,
      {
        requestId: "excepted",
        tabId: 1,
        frameId: 0,
        documentUrl: "https://publisher.test/article",
        requestUrl:
          "https://mixed.test/users/person%40example.test/0123456789/asset.js?token=secret",
        requestType: "script",
        timestamp: 200,
      },
      {
        decision: requestDecision("excepted", 1, "allow", "easyprivacy", {
          matchedFilter: ruleEvidence("easyprivacy:block"),
          matchedException: ruleEvidence("easyprivacy:exception"),
        }),
      },
    );

    const rowId = excepted.row?.id ?? "";
    const details = summarizeHostRequestDetails(state, state.generation, rowId);
    expect(details).toMatchObject({
      rowId,
      truncated: true,
    });
    expect(details?.samples).toHaveLength(6);
    expect(
      details?.samples.find((sample) => sample.source === "easyprivacy"),
    ).toMatchObject({
      source: "easyprivacy",
      reason: "easyprivacy-exception",
      pathHint: "/users/…/…/asset.js",
      sourceHost: "publisher.test",
      matchedException: { key: "easyprivacy:exception" },
    });
    expect(JSON.stringify(details)).not.toContain("person@example.test");
    expect(JSON.stringify(details)).not.toContain("token=secret");
    expect(
      summarizeHostRequestDetails(state, state.generation + 1, rowId),
    ).toBeNull();
  });

  it("returns only scrubbed URL paths as request hints", () => {
    expect(
      formatPrivacySafePathHint(
        "https://tracker.test/a/550e8400-e29b-41d4-a716-446655440000/file.js?secret=value",
      ),
    ).toBe("/a/…/….js");
    expect(formatPrivacySafePathHint("not a url")).toBeNull();
  });

  it("resets observations for a new top-level page", () => {
    const state = createTabObservationState(1, "https://example.com");

    recordObservedRequest(state, {
      tabId: 1,
      frameId: 0,
      requestUrl: "https://tracker.test/script.js",
      requestType: "script",
      timestamp: 100,
    });

    resetTabObservationState(state, "https://next.example");

    expect(summarizeTabObservation(state)).toMatchObject({
      siteUrl: "https://next.example",
      siteHost: "next.example",
      requestCounts: { total: 0, blocked: 0, restricted: 0, allowed: 0 },
      rows: [],
    });
    expect(state.generation).toBe(1);
    expect(state.activeRequests.size).toBe(0);

    resetTabObservationState(state, "https://next.example");
    expect(state.generation).toBe(2);
  });

  it("returns an empty summary for a fresh tab state", () => {
    expect(
      summarizeTabObservation(createTabObservationState(42, "https://example.com")),
    ).toMatchObject({
      tabId: 42,
      siteHost: "example.com",
      hostCounts: {
        thirdParty: 0,
        unknown: 0,
        firstParty: 0,
        blocked: 0,
        allowed: 0,
      },
      requestCounts: { total: 0, blocked: 0, restricted: 0, allowed: 0 },
      rows: [],
    });
  });
});
