import { describe, expect, it } from "vitest";

import {
  createTabObservationState,
  mapRequestType,
  recordObservedRequest,
  recordRequestCompleted,
  recordRequestFailed,
  recordRequestRedirect,
  resetTabObservationState,
  summarizeTabObservation,
} from "./requestObservation";

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
      thirdPartyCount: 2,
      unknownCount: 2,
      firstPartyCount: 0,
      blockedCount: 0,
      allowedCount: 2,
      totalRequests: 2,
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
          ruleSource: "automatic",
          status: "allowed",
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
          ruleSource: "automatic",
          status: "allowed",
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
      thirdPartyCount: 1,
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
          ruleSource: "automatic",
          status: "blocked",
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
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          displayName: "www.google-analytics.com",
          ruleSource: "allowed-by-user",
          status: "allowed",
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

    expect(
      summarizeTabObservation(state, {
        sitePaused: true,
      }),
    ).toMatchObject({
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          displayName: "www.google-analytics.com",
          ruleSource: "site-paused",
          status: "allowed-paused",
        },
      ],
    });
  });

  it("recomputes summary decisions with current settings", () => {
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
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          displayName: "www.google-analytics.com",
          ruleSource: "allowed-by-user",
          status: "allowed",
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
      allowedCount: 1,
      rows: [
        {
          displayName: "cdnjs.cloudflare.com",
          siteDomain: "cloudflare.com",
          category: "cdn",
          entity: "Cloudflare",
          catalogDefaultAction: "allow",
          explanation:
            "This domain is commonly used to load shared JavaScript or CSS libraries from a CDN.",
          status: "allowed",
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
      thirdPartyCount: 0,
      unknownCount: 0,
      firstPartyCount: 1,
      allowedCount: 1,
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
      pageUrl: "https://frame.tracker.test/embed",
      requestUrl: "https://frame.tracker.test/app.js",
      requestType: "script",
      timestamp: 100,
    });

    expect(summarizeTabObservation(state)).toMatchObject({
      thirdPartyCount: 1,
      firstPartyCount: 0,
      rows: [
        {
          host: "frame.tracker.test",
          siteDomain: "tracker.test",
          displayName: "frame.tracker.test",
          relationship: "third-party",
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
      thirdPartyCount: 1,
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
      thirdPartyCount: 1,
      totalRequests: 2,
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
      unknownCount: 1,
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          displayName: "Unclassifiable request",
          relationship: "unknown",
          status: "allowed",
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
      unknownCount: 1,
      allowedCount: 1,
      rows: [
        {
          displayName: "moz-extension:extension-id",
          relationship: "unknown",
          status: "allowed",
        },
      ],
    });
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
      totalRequests: 0,
      rows: [],
    });
  });

  it("returns an empty summary for a fresh tab state", () => {
    expect(
      summarizeTabObservation(createTabObservationState(42, "https://example.com")),
    ).toMatchObject({
      tabId: 42,
      siteHost: "example.com",
      thirdPartyCount: 0,
      unknownCount: 0,
      firstPartyCount: 0,
      blockedCount: 0,
      allowedCount: 0,
      rows: [],
    });
  });
});
