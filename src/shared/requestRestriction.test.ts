import { describe, expect, it } from "vitest";

import {
  decideHeaderRestriction,
  stripTrackingRequestHeaders,
} from "./requestRestriction";
import type { TrackerCatalogEntry } from "./trackerCatalog";

describe("request restriction", () => {
  it("removes only cookies and referrers from restricted requests", () => {
    const decision = decideHeaderRestriction({
      pageUrl: "https://example.com",
      requestUrl: "https://o123.ingest.sentry.io/api/123/store/",
      sitePaused: false,
    });
    const headers = stripTrackingRequestHeaders([
      { name: "Cookie", value: "session=secret" },
      { name: "REFERER", value: "https://example.com/private" },
      { name: "Accept", value: "application/json" },
    ]);

    expect(decision.shouldRestrictHeaders).toBe(true);
    expect(headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
  });

  it("honors pauses and user allow overrides", () => {
    const input = {
      pageUrl: "https://example.com",
      requestUrl: "https://o123.ingest.sentry.io/api/123/store/",
    };

    expect(
      decideHeaderRestriction({ ...input, sitePaused: true })
        .shouldRestrictHeaders,
    ).toBe(false);
    expect(
      decideHeaderRestriction({
        ...input,
        sitePaused: false,
        domainOverrides: { "o123.ingest.sentry.io": "allow" },
      }).shouldRestrictHeaders,
    ).toBe(false);
  });

  it("applies precise path restrictions without restricting other paths", () => {
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
    const baseInput = {
      pageUrl: "https://example.com",
      sitePaused: false,
      catalog,
    };

    expect(
      decideHeaderRestriction({
        ...baseInput,
        requestUrl: "https://cdn.example.test/collect/events",
      }).shouldRestrictHeaders,
    ).toBe(true);
    expect(
      decideHeaderRestriction({
        ...baseInput,
        requestUrl: "https://cdn.example.test/assets/app.js",
      }).shouldRestrictHeaders,
    ).toBe(false);
  });
});
