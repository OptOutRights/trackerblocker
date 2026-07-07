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
    expect(TRACKER_CATALOG.length).toBeGreaterThan(0);
    expect(TRACKER_CATALOG).toContainEqual(
      expect.objectContaining({
        domain: "google-analytics.com",
        category: "analytics",
        defaultAction: "block",
      }),
    );
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
    },
    {
      id: "specific-cdn",
      matchType: "domain",
      domain: "cdn.example.com",
      entity: "Example",
      category: "cdn",
      defaultAction: "allow",
      explanation: "This domain is commonly used to deliver site assets.",
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
        },
      ]),
    ).toThrow("invalid category");
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
    };

    expect(() => loadTrackerCatalog([validEntry, validEntry])).toThrow(
      "Duplicate tracker catalog id",
    );
  });
});
