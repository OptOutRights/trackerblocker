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
  it("aggregates repeated third-party requests by registrable domain", () => {
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
      thirdPartyCount: 1,
      unknownCount: 1,
      firstPartyCount: 0,
      blockedCount: 0,
      allowedCount: 0,
      totalRequests: 2,
      rows: [
        {
          displayName: "tracker.test",
          relationship: "third-party",
          requestCount: 2,
          requestTypes: ["image", "script"],
          category: "unknown",
          entity: null,
          catalogDefaultAction: null,
          ruleSource: "automatic",
          status: "unknown",
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
          displayName: "google-analytics.com",
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
        "google-analytics.com": "allow",
      },
    });

    expect(
      summarizeTabObservation(state, {
        domainOverrides: {
          "google-analytics.com": "allow",
        },
      }),
    ).toMatchObject({
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          displayName: "google-analytics.com",
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
          displayName: "google-analytics.com",
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
          "google-analytics.com": "allow",
        },
      }),
    ).toMatchObject({
      blockedCount: 0,
      allowedCount: 1,
      rows: [
        {
          ruleSource: "allowed-by-user",
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
      firstPartyCount: 1,
      rows: [
        {
          displayName: "example.co.uk",
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
          displayName: "tracker.test",
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
          displayName: "tracker.test",
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
      rows: [
        {
          displayName: "Unclassifiable request",
          relationship: "unknown",
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
      rows: [
        {
          displayName: "moz-extension:extension-id",
          relationship: "unknown",
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
