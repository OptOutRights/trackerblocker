import { describe, expect, it } from "vitest";

import {
  createTabObservationState,
  mapRequestType,
  recordObservedRequest,
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
    expect(mapRequestType("websocket")).toBe("other");
    expect(mapRequestType("font")).toBe("other");
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
          requestTypes: ["other"],
        },
      ],
    });
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
