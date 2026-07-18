import { describe, expect, it } from "vitest";

import type { FilterMatchResult } from "./filterEngine";
import {
  RequestDecisionCache,
  createNavigationAllowDecision,
  decideRequest,
  decideRequestPolicy,
  normalizeRequestContext,
  toRuleDecisionPresentation,
  type RequestDecision,
} from "./requestDecisions";
import type { TrackerCatalogEntry } from "./trackerCatalog";

const FILTER_BLOCK: FilterMatchResult = {
  outcome: "block",
  health: "ready",
  matchedFilter: { id: "easyprivacy:00000001" },
  matchedException: null,
};
const FILTER_EXCEPTION: FilterMatchResult = {
  outcome: "exception",
  health: "ready",
  matchedFilter: { id: "easyprivacy:00000001" },
  matchedException: { id: "easyprivacy:00000002" },
};

const CATALOG: TrackerCatalogEntry[] = [
  {
    id: "tracker",
    matchType: "domain",
    domain: "tracker.test",
    entity: "Tracker",
    category: "analytics",
    defaultAction: "block",
    explanation: "This domain collects test analytics.",
    breakageRisk: "low",
  },
  {
    id: "restricted",
    matchType: "domain",
    domain: "restricted.test",
    entity: "Restricted",
    category: "observability",
    defaultAction: "restrict",
    explanation: "This domain receives test diagnostics.",
    breakageRisk: "low",
  },
  {
    id: "functional",
    matchType: "domain",
    domain: "functional.test",
    entity: "Functional",
    category: "cdn",
    defaultAction: "allow",
    explanation: "This domain serves test resources.",
  },
];

function context(
  requestUrl = "https://tracker.test/collect",
  pageUrl = "https://publisher.test/",
) {
  return normalizeRequestContext({
    requestId: "request-1",
    tabId: 1,
    pageUrl,
    documentUrl: pageUrl,
    requestUrl,
    requestType: "xmlhttprequest",
  });
}

describe("normalizeRequestContext", () => {
  it("keeps browser details behind a normalized TrackerBlocker contract", () => {
    expect(
      normalizeRequestContext({
        requestId: "request-1",
        tabId: 1,
        pageUrl: "https://publisher.test/",
        documentUrl: "https://frame.test/document",
        originUrl: "https://origin.test/",
        initiator: "https://initiator.test/",
        requestUrl: "https://tracker.test/collect",
        requestType: "xmlhttprequest",
      }),
    ).toEqual({
      requestId: "request-1",
      tabId: 1,
      pageUrl: "https://publisher.test/",
      requestUrl: "https://tracker.test/collect",
      requestType: "xmlhttprequest",
      sourceUrl: "https://frame.test/document",
      requestHost: "tracker.test",
      requestSite: "tracker.test",
      relationship: "third-party",
    });
  });

  it("uses source fallbacks without inventing a relationship", () => {
    expect(
      normalizeRequestContext({
        tabId: 1,
        originUrl: "https://origin.test/",
        requestUrl: "https://tracker.test/collect",
      }),
    ).toMatchObject({
      requestId: "",
      pageUrl: null,
      sourceUrl: "https://origin.test/",
      requestHost: null,
      requestSite: null,
      relationship: "unknown",
    });
  });
});

describe("decideRequest", () => {
  it("preserves every existing automatic behavior while matching is off", () => {
    const cases = [
      ["https://tracker.test/collect", "block", "catalog"],
      ["https://restricted.test/envelope", "restrict", "catalog"],
      ["https://functional.test/app.js", "allow", "catalog"],
      ["https://unknown.test/app.js", "allow", "default"],
    ] as const;

    for (const [requestUrl, action, source] of cases) {
      const decision = decideRequest({
        context: context(requestUrl),
        catalog: CATALOG,
        easyPrivacyEnabled: false,
        filterMatch: FILTER_BLOCK,
      });

      expect(decision).toMatchObject({ action, source });
      expect(decision.matchedFilter).toBeNull();
      expect(decision.matchedException).toBeNull();
    }

    expect(
      decideRequest({
        context: context(
          "https://static.publisher.test/app.js",
          "https://www.publisher.test/",
        ),
        catalog: CATALOG,
        easyPrivacyEnabled: false,
        filterMatch: FILTER_BLOCK,
      }),
    ).toMatchObject({
      action: "allow",
      source: "default",
      relationship: "first-party",
    });
    expect(
      decideRequest({
        context: normalizeRequestContext({
          requestId: "unknown",
          tabId: 1,
          requestUrl: "data:text/plain,hello",
        }),
        easyPrivacyEnabled: false,
        filterMatch: FILTER_BLOCK,
      }),
    ).toMatchObject({
      action: "allow",
      source: "default",
      relationship: "unknown",
    });
  });

  it("uses the approved precedence", () => {
    const base = {
      relationship: "third-party" as const,
      catalogDefaultAction: "block" as const,
      easyPrivacyEnabled: true,
      filterMatch: FILTER_BLOCK,
    };

    expect(decideRequestPolicy({ ...base, sitePaused: true })).toMatchObject({
      action: "allow",
      source: "site-pause",
    });
    expect(
      decideRequestPolicy({ ...base, domainOverride: "allow" }),
    ).toMatchObject({ action: "allow", source: "user-allow" });
    expect(
      decideRequestPolicy({
        ...base,
        domainOverride: "block",
        filterMatch: FILTER_EXCEPTION,
      }),
    ).toMatchObject({ action: "block", source: "user-block" });
    expect(
      decideRequestPolicy({ ...base, filterMatch: FILTER_EXCEPTION }),
    ).toMatchObject({
      action: "allow",
      source: "easyprivacy",
      matchedException: FILTER_EXCEPTION.matchedException,
    });
    expect(decideRequestPolicy(base)).toMatchObject({
      action: "block",
      source: "easyprivacy",
      matchedFilter: FILTER_BLOCK.matchedFilter,
    });
  });

  it("lets an exception stop catalog fallback", () => {
    expect(
      decideRequest({
        context: context(),
        catalog: CATALOG,
        easyPrivacyEnabled: true,
        filterMatch: FILTER_EXCEPTION,
      }),
    ).toMatchObject({
      action: "allow",
      source: "easyprivacy",
      catalogMatch: { action: "block" },
    });
  });

  it("allows an explicit EasyPrivacy filter before the first-party default", () => {
    expect(
      decideRequest({
        context: context(
          "https://publisher.test/tracking/collect",
          "https://publisher.test/",
        ),
        easyPrivacyEnabled: true,
        filterMatch: FILTER_BLOCK,
      }),
    ).toMatchObject({
      action: "block",
      source: "easyprivacy",
      relationship: "first-party",
    });
  });

  it("falls back completely while the engine is loading or degraded", () => {
    for (const health of ["loading", "degraded"] as const) {
      expect(
        decideRequest({
          context: context(),
          catalog: CATALOG,
          easyPrivacyEnabled: true,
          filterMatch: {
            outcome: "unavailable",
            health,
            matchedFilter: null,
            matchedException: null,
          },
        }),
      ).toMatchObject({ action: "block", source: "catalog" });
    }
  });

  it("makes catalog restriction explicit on the decision", () => {
    expect(
      decideRequest({
        context: context("https://restricted.test/envelope"),
        catalog: CATALOG,
      }),
    ).toMatchObject({
      action: "restrict",
      source: "catalog",
      headerRestriction: { removeHeaders: ["cookie", "referer"] },
    });
  });

  it("preserves path-specific catalog restrictions", () => {
    const catalog: TrackerCatalogEntry[] = [
      {
        id: "mixed-service",
        matchType: "domain",
        domain: "cdn.example.test",
        entity: "Example",
        category: "cdn",
        defaultAction: "allow",
        explanation: "This domain provides mixed-use resources.",
        rules: [
          {
            id: "collection-endpoint",
            matchType: "path-prefix",
            value: "/collect",
            action: "restrict",
          },
        ],
      },
    ];

    expect(
      decideRequest({
        context: context("https://cdn.example.test/collect/events"),
        catalog,
      }),
    ).toMatchObject({
      action: "restrict",
      headerRestriction: { removeHeaders: ["cookie", "referer"] },
      catalogMatch: { matchedRule: { id: "collection-endpoint" } },
    });
    expect(
      decideRequest({
        context: context("https://cdn.example.test/assets/app.js"),
        catalog,
      }),
    ).toMatchObject({ action: "allow", headerRestriction: null });
  });

  it("preserves hostname overrides for third- and first-party requests", () => {
    expect(
      decideRequest({
        context: context(),
        catalog: CATALOG,
        domainOverrides: { "tracker.test": "allow" },
      }),
    ).toMatchObject({ action: "allow", source: "user-allow" });
    expect(
      decideRequest({
        context: context(
          "https://static.publisher.test/app.js",
          "https://www.publisher.test/",
        ),
        domainOverrides: { "static.publisher.test": "block" },
      }),
    ).toMatchObject({ action: "block", source: "user-block" });
  });

  it("maps decisions to the existing popup status contract", () => {
    expect(
      toRuleDecisionPresentation(
        decideRequest({ context: context(), catalog: CATALOG }),
      ),
    ).toEqual({
      status: "blocked",
      source: "automatic",
      shouldBlock: true,
      shouldRestrictHeaders: false,
    });
    expect(
      toRuleDecisionPresentation(
        decideRequest({
          context: context(),
          catalog: CATALOG,
          sitePaused: true,
        }),
      ),
    ).toEqual({
      status: "allowed-paused",
      source: "site-paused",
      shouldBlock: false,
      shouldRestrictHeaders: false,
    });
  });
});

describe("RequestDecisionCache", () => {
  function decision(
    requestId: string,
    tabId: number,
    action: RequestDecision["action"] = "allow",
  ): RequestDecision {
    const normalized = normalizeRequestContext({
      requestId,
      tabId,
      pageUrl: "https://publisher.test/",
      requestUrl: "https://tracker.test/collect",
      requestType: "xmlhttprequest",
    });

    return {
      ...createNavigationAllowDecision(normalized),
      action,
    };
  }

  it("reuses the exact request decision and replaces redirect hops", () => {
    const cache = new RequestDecisionCache();
    const first = decision("request-1", 1, "block");
    const redirected = decision("request-1", 1, "allow");

    cache.set(first);
    expect(cache.get("request-1", 1)).toBe(first);
    cache.set(redirected);
    expect(cache.get("request-1", 1)).toBe(redirected);
  });

  it("does not reclassify repeated listeners for the same request", () => {
    const cache = new RequestDecisionCache();
    const original = decision("request-1", 1, "restrict");
    let createCount = 0;
    const create = () => {
      createCount += 1;
      return original;
    };

    expect(cache.resolve("request-1", 1, create)).toBe(original);
    expect(cache.resolve("request-1", 1, create)).toBe(original);
    expect(createCount).toBe(1);
  });

  it("rejects a stale request id reused by another tab", () => {
    const cache = new RequestDecisionCache();
    cache.set(decision("request-1", 1));

    expect(cache.get("request-1", 2)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("cleans completion, tab-removal, and full-reset boundaries", () => {
    const cache = new RequestDecisionCache();
    cache.set(decision("request-1", 1));
    cache.set(decision("request-2", 1));
    cache.set(decision("request-3", 2));

    cache.delete("request-1");
    expect(cache.get("request-1")).toBeNull();
    cache.deleteTab(1);
    expect(cache.get("request-2")).toBeNull();
    expect(cache.get("request-3", 2)).not.toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("does not retain requests without an id", () => {
    const cache = new RequestDecisionCache();
    cache.set(decision("", 1));
    expect(cache.size).toBe(0);
  });
});
