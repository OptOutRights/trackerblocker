import { describe, expect, it } from "vitest";

import {
  loadTrackerCatalog,
  lookupTrackerCatalogEntry,
  TRACKER_CATALOG,
  UNKNOWN_THIRD_PARTY_EXPLANATION,
  type TrackerCatalogEntry,
} from "./trackerCatalog";

describe("TRACKER_CATALOG", () => {
  it("loads the packaged catalog", () => {
    expect(TRACKER_CATALOG.length).toBeGreaterThanOrEqual(60);
    expect(TRACKER_CATALOG).toContainEqual(
      expect.objectContaining({
        domain: "google-analytics.com",
        category: "analytics",
        defaultAction: "block",
      }),
    );
  });

  it("blocks representative high-confidence tracker categories", () => {
    expect(lookupTrackerCatalogEntry("pagead2.googlesyndication.com")).toMatchObject({
      entry: {
        entity: "Google",
        category: "advertising",
        defaultAction: "block",
      },
    });
    expect(lookupTrackerCatalogEntry("api2.amplitude.com")).toMatchObject({
      entry: {
        entity: "Amplitude",
        category: "analytics",
        defaultAction: "block",
      },
    });
    expect(lookupTrackerCatalogEntry("static.hotjar.com")).toMatchObject({
      entry: {
        entity: "Hotjar",
        category: "session-replay",
        defaultAction: "block",
      },
    });
    expect(lookupTrackerCatalogEntry("tr.snapchat.com")).toMatchObject({
      entry: {
        entity: "Snap",
        category: "social",
        defaultAction: "block",
      },
    });
    expect(lookupTrackerCatalogEntry("widgets.outbrain.com")).toMatchObject({
      entry: {
        entity: "Outbrain",
        category: "advertising",
        defaultAction: "block",
      },
    });
  });

  it("blocks confirmed adtech and collection endpoints", () => {
    const confirmedEndpoints = [
      ["securepubads.g.doubleclick.net", "Google", "advertising"],
      ["www.googletagservices.com", "Google", "advertising"],
      ["aax.amazon-adsystem.com", "Amazon", "advertising"],
      ["pixel.adsafeprotected.com", "Integral Ad Science", "advertising"],
      ["metrics.omtrdc.net", "Adobe", "analytics"],
      ["example.2o7.net", "Adobe", "analytics"],
      ["dpm.demdex.net", "Adobe", "advertising"],
      ["cm.everesttech.net", "Adobe", "advertising"],
      ["cdn.permutive.com", "Permutive", "advertising"],
      ["static.cloudflareinsights.com", "Cloudflare", "analytics"],
      ["connect.facebook.net", "Meta", "social"],
      ["cdn.segment.com", "Twilio Segment", "analytics"],
      ["api.segment.io", "Twilio Segment", "analytics"],
      ["api2.amplitude.com", "Amplitude", "analytics"],
      ["api-js.mixpanel.com", "Mixpanel", "analytics"],
      ["data.pendo.io", "Pendo", "analytics"],
    ] as const;

    for (const [domain, entity, category] of confirmedEndpoints) {
      expect(lookupTrackerCatalogEntry(domain)).toMatchObject({
        entry: {
          entity,
          category,
          defaultAction: "block",
        },
      });
    }
  });

  it("does not block broad product or integration domains by default", () => {
    for (const domain of [
      "googletagmanager.com",
      "facebook.net",
      "segment.io",
      "amplitude.com",
      "mixpanel.com",
      "pendo.io",
    ]) {
      expect(lookupTrackerCatalogEntry(domain)).toBeNull();
    }
  });

  it("keeps functional service categories allowed", () => {
    for (const domain of [
      "js.stripe.com",
      "www.paypal.com",
      "newassets.hcaptcha.com",
      "www.cloudflare.com",
      "cdnjs.cloudflare.com",
    ]) {
      expect(lookupTrackerCatalogEntry(domain)).toMatchObject({
        entry: {
          defaultAction: "allow",
        },
      });
    }
  });

  it("uses restrict for observability services instead of blocking", () => {
    expect(lookupTrackerCatalogEntry("o123.ingest.sentry.io")).toMatchObject({
      entry: {
        entity: "Sentry",
        category: "observability",
        defaultAction: "restrict",
      },
      action: "restrict",
    });
  });

  it("keeps block entries in intentionally blockable categories", () => {
    const blockableCategories = new Set([
      "advertising",
      "analytics",
      "session-replay",
      "social",
    ]);

    for (const entry of TRACKER_CATALOG) {
      if (entry.defaultAction === "block") {
        expect(blockableCategories.has(entry.category)).toBe(true);
      }
    }
  });

  it("requires breakage risk without inventing evidence provenance", () => {
    for (const entry of TRACKER_CATALOG) {
      if (entry.defaultAction === "block") {
        expect(entry.breakageRisk).toMatch(/^(low|medium|high)$/);
      }

      expect(entry.source).not.toBe("curated-local-review");
      expect(Boolean(entry.source)).toBe(Boolean(entry.confidence));
    }
  });

  it("keeps explanations concise and local", () => {
    for (const entry of TRACKER_CATALOG) {
      expect(entry.explanation).toMatch(/\.$/);
      expect(entry.explanation).not.toMatch(/^https?:\/\//i);
      expect(entry.explanation.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(
        35,
      );
    }
  });

  it("keeps the unknown fallback cautious", () => {
    expect(UNKNOWN_THIRD_PARTY_EXPLANATION).toContain(
      "not in the local tracker catalog",
    );
  });
});

describe("lookupTrackerCatalogEntry", () => {
  const catalog: TrackerCatalogEntry[] = [
    {
      id: "generic-example",
      matchType: "suffix",
      domain: "example.com",
      entity: "Example",
      category: "analytics",
      defaultAction: "block",
      explanation: "This domain is commonly used for analytics.",
      source: "test-fixture",
      confidence: "high",
      breakageRisk: "low",
    },
    {
      id: "specific-cdn",
      matchType: "domain",
      domain: "cdn.example.com",
      entity: "Example",
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

  it("matches exact catalog domains", () => {
    expect(lookupTrackerCatalogEntry("google-analytics.com")).toMatchObject({
      entry: {
        entity: "Google",
        category: "analytics",
        defaultAction: "block",
      },
      matchedDomain: "google-analytics.com",
      action: "block",
      matchedRule: null,
    });
  });

  it("lets precise path rules override broad host defaults", () => {
    expect(
      lookupTrackerCatalogEntry(
        "cdn.example.com",
        catalog,
        "https://cdn.example.com/collect/pixel.gif?user=123",
      ),
    ).toMatchObject({
      entry: {
        id: "specific-cdn",
        defaultAction: "allow",
      },
      action: "block",
      matchedRule: {
        id: "collect-endpoint",
      },
    });
  });

  it("matches suffix catalog domains on label boundaries", () => {
    expect(lookupTrackerCatalogEntry("stats.google-analytics.com")).toMatchObject({
      entry: {
        domain: "google-analytics.com",
      },
    });
    expect(lookupTrackerCatalogEntry("notgoogle-analytics.com")).toBeNull();
  });

  it("prefers the longest and most specific match", () => {
    expect(lookupTrackerCatalogEntry("cdn.example.com", catalog)).toMatchObject({
      entry: {
        id: "specific-cdn",
        category: "cdn",
      },
    });
  });

  it("normalizes case, whitespace, and trailing dots", () => {
    expect(lookupTrackerCatalogEntry(" Stats.Google-Analytics.COM. ")).toMatchObject({
      entry: {
        domain: "google-analytics.com",
      },
      matchedDomain: "stats.google-analytics.com",
    });
  });

  it("returns null for unknown or missing domains", () => {
    expect(lookupTrackerCatalogEntry("unknown.example")).toBeNull();
    expect(lookupTrackerCatalogEntry("")).toBeNull();
    expect(lookupTrackerCatalogEntry(null)).toBeNull();
  });
});

describe("loadTrackerCatalog", () => {
  it("rejects malformed catalog data", () => {
    expect(() => loadTrackerCatalog({})).toThrow("must be an array");
    expect(() => loadTrackerCatalog([{ id: "missing-fields" }])).toThrow(
      "needs domain",
    );
    expect(() =>
      loadTrackerCatalog([
        {
          id: "bad-category",
          matchType: "suffix",
          domain: "example.com",
          entity: "Example",
          category: "tracking",
          defaultAction: "block",
          explanation: "This domain is commonly used for analytics.",
          source: "test-fixture",
          confidence: "high",
          breakageRisk: "low",
        },
      ]),
    ).toThrow("invalid category");
    expect(() =>
      loadTrackerCatalog([
        {
          id: "missing-review",
          matchType: "suffix",
          domain: "example.com",
          entity: "Example",
          category: "analytics",
          defaultAction: "block",
          explanation: "This domain is commonly used for analytics.",
        },
      ]),
    ).toThrow("needs breakageRisk");
    expect(() =>
      loadTrackerCatalog([
        {
          id: "missing-restrict-risk",
          matchType: "suffix",
          domain: "errors.example.com",
          entity: "Example",
          category: "observability",
          defaultAction: "restrict",
          explanation: "This domain is commonly used for error reporting.",
        },
      ]),
    ).toThrow("needs breakageRisk");
    expect(() =>
      loadTrackerCatalog([
        {
          id: "incomplete-provenance",
          matchType: "suffix",
          domain: "example.com",
          entity: "Example",
          category: "cdn",
          defaultAction: "allow",
          explanation: "This domain is commonly used to deliver assets.",
          source: "specific-source",
        },
      ]),
    ).toThrow("needs both source and confidence");
  });

  it("rejects duplicate ids", () => {
    const validEntry = {
      id: "duplicate",
      matchType: "suffix",
      domain: "example.com",
      entity: "Example",
      category: "analytics",
      defaultAction: "block",
      explanation: "This domain is commonly used for analytics.",
      source: "test-fixture",
      confidence: "high",
      breakageRisk: "low",
    };

    expect(() => loadTrackerCatalog([validEntry, validEntry])).toThrow(
      "Duplicate tracker catalog id",
    );
  });
});
