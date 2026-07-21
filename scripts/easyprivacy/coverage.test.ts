import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { FilterEngine, type FilterMatchResult } from "../../src/shared/filterEngine";
import {
  decideMainFrameRequest,
  decideRequest,
  normalizeRequestContext,
  type RequestDecision,
} from "../../src/shared/requestDecisions";
import {
  createTabObservationState,
  recordObservedRequest,
  recordRequestRedirect,
  summarizeTabObservation,
} from "../../src/shared/requestObservation";
import type { TrackerCatalogEntry } from "../../src/shared/trackerCatalog";
import { normalizeSettings } from "../../src/storage/settings";

interface CoverageFixture {
  id: string;
  groups: string[];
  pair?: string;
  decisionMode?: "main-frame";
  pageUrl: string;
  documentUrl?: string;
  url: string;
  type: string;
  expectedMatch: "block" | "exception" | "no-match";
  expectedAction: "block" | "allow";
  expectedCatalogAction: "block" | "allow";
}

interface CoverageCorpus {
  reviewedArtifact: Record<string, string>;
  requests: CoverageFixture[];
  unsupportedCases: Array<{ id: string; category: string; sample: string }>;
}

const corpus = JSON.parse(
  await readFile(new URL("./coverage-fixtures.json", import.meta.url), "utf8"),
) as CoverageCorpus;
const metadata = JSON.parse(
  await readFile(
    new URL("../../public/filter-data/easyprivacy.metadata.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const capabilities = JSON.parse(
  await readFile(
    new URL(
      "../../public/filter-data/easyprivacy.capabilities.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  excludedNetworkRuleSamples: Record<string, string[]>;
  unsupportedSamples: Array<{ category: string; filter: string }>;
};
const artifact = new Uint8Array(
  await readFile(
    new URL("../../public/filter-data/easyprivacy.engine", import.meta.url),
  ),
);
const engine = new FilterEngine();
const evaluated = new Map<
  string,
  { fixture: CoverageFixture; match: FilterMatchResult; easyPrivacy: RequestDecision; catalog: RequestDecision }
>();

beforeAll(async () => {
  await engine.initialize(async () => ({ artifact, metadata }));
  for (const fixture of corpus.requests) {
    const context = normalizeRequestContext({
      requestId: fixture.id,
      tabId: 1,
      pageUrl: fixture.pageUrl,
      documentUrl: fixture.documentUrl,
      requestUrl: fixture.url,
      requestType: fixture.type,
    });
    const match = engine.match({
      requestId: context.requestId,
      tabId: context.tabId,
      url: context.requestUrl,
      sourceUrl: context.sourceUrl,
      type: context.requestType,
    });
    const automaticDecision = fixture.decisionMode === "main-frame"
      ? decideMainFrameRequest({ context })
      : decideRequest({
          context,
          easyPrivacyEnabled: true,
          filterMatch: match,
        });
    const catalogDecision = fixture.decisionMode === "main-frame"
      ? decideMainFrameRequest({ context })
      : decideRequest({ context, easyPrivacyEnabled: false });
    evaluated.set(fixture.id, {
      fixture,
      match,
      easyPrivacy: automaticDecision,
      catalog: catalogDecision,
    });
  }
});

describe("EasyPrivacy Phase 5 production coverage corpus", () => {
  it("is pinned to the exact retained source and production artifact", () => {
    expect(corpus.reviewedArtifact).toEqual({
      upstreamVersion: metadata.upstreamVersion,
      upstreamCommit: metadata.upstreamCommit,
      sourceSha256: metadata.sourceSha256,
      artifactSha256: metadata.artifactSha256,
    });
    expect(engine.provenance).toMatchObject(corpus.reviewedArtifact);
  });

  it("matches every labeled request and preserves its expected policy", () => {
    for (const result of evaluated.values()) {
      expect(result.match.outcome, result.fixture.id).toBe(
        result.fixture.expectedMatch,
      );
      expect(result.easyPrivacy.action, result.fixture.id).toBe(
        result.fixture.expectedAction,
      );
      expect(result.catalog.action, result.fixture.id).toBe(
        result.fixture.expectedCatalogAction,
      );
    }
  });

  it("meets every block, exception, type, source, frame, and first-party minimum", () => {
    expect(group("ordinary-block")).toHaveLength(8);
    expect(group("exception")).toHaveLength(6);
    expectPairs("type-positive", "type-negative", 6);
    expectPairs("source-positive", "source-negative", 6);
    expect(group("frame-source")).toHaveLength(2);
    expectPairs("first-party-positive", "first-party-negative", 4);
    expect(group("main-frame-boundary")).toHaveLength(1);
    expect(required("main-frame-automatic-bypass")).toMatchObject({
      match: { outcome: "block" },
      easyPrivacy: {
        action: "allow",
        reason: "main-frame-automatic-disabled",
      },
    });
  });

  it("keeps loading and degraded engines on complete catalog fallback", () => {
    const fallbackCatalog: TrackerCatalogEntry[] = [
      {
        id: "phase5-fallback",
        matchType: "domain",
        domain: "functional.test",
        entity: "Phase 5 fixture",
        category: "analytics",
        defaultAction: "block",
        explanation: "Synthetic local fallback fixture.",
        breakageRisk: "low",
      },
    ];
    const context = normalizeRequestContext({
      requestId: "fallback",
      tabId: 1,
      pageUrl: "https://publisher.test/",
      requestUrl: "https://functional.test/collect",
      requestType: "image",
    });

    for (const health of ["loading", "degraded"] as const) {
      expect(
        decideRequest({
          context,
          catalog: fallbackCatalog,
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

  it("preserves all five pause and user-control precedence cases", () => {
    const blocked = required("ordinary-screen13");
    const excepted = required("exception-bam-abema");
    const context = contextFor(blocked.fixture);

    expect(
      decideRequest({
        context,
        sitePaused: true,
        easyPrivacyEnabled: true,
        filterMatch: blocked.match,
      }),
    ).toMatchObject({ action: "allow", source: "site-pause" });
    expect(
      decideRequest({
        context,
        siteAllows: { "publisher.test": { "screen13.com": true } },
        easyPrivacyEnabled: true,
        filterMatch: blocked.match,
      }),
    ).toMatchObject({ action: "allow", source: "site-allow" });
    expect(
      decideRequest({
        context,
        domainOverrides: { "screen13.com": "allow" },
        easyPrivacyEnabled: true,
        filterMatch: blocked.match,
      }),
    ).toMatchObject({ action: "allow", source: "user-allow" });
    expect(
      decideRequest({
        context: contextFor(excepted.fixture),
        domainOverrides: { "bam.nr-data.net": "block" },
        easyPrivacyEnabled: true,
        filterMatch: excepted.match,
      }),
    ).toMatchObject({ action: "block", source: "user-block" });
    expect(excepted.easyPrivacy).toMatchObject({
      action: "allow",
      source: "easyprivacy",
      reason: "easyprivacy-exception",
    });
  });

  it("reclassifies two redirect sequences and retains each attempt", () => {
    for (const [index, ids] of [
      ["type-screen13-negative", "type-screen13-positive"],
      ["source-yahoo-negative", "source-yahoo-positive"],
    ].entries()) {
      const [first, second] = ids.map(required);
      const state = createTabObservationState(index + 1, first.fixture.pageUrl);
      const requestId = `redirect-${index}`;
      recordDecision(state, first, requestId, 100);
      recordRequestRedirect(state, {
        requestId,
        fromUrl: `${first.fixture.url}?secret=first`,
        redirectUrl: `${second.fixture.url}?secret=second`,
        statusCode: 302,
        timestamp: 110,
      });
      recordDecision(state, second, requestId, 120);
      const summary = summarizeTabObservation(state);
      expect(summary.requestCounts.total).toBe(2);
      expect(summary.requestCounts.blocked).toBe(1);
      expect(summary.requestCounts.allowed).toBe(1);
      expect(JSON.stringify(summary)).not.toContain("secret=");
    }
  });

  it("keeps two production-matcher mixed hosts truthful", () => {
    for (const ids of [
      ["type-screen13-positive", "type-screen13-negative"],
      ["type-firecrux-positive", "type-firecrux-negative"],
    ]) {
      const results = ids.map(required);
      const state = createTabObservationState(1, "https://publisher.test/");
      results.forEach((result, index) =>
        recordDecision(state, result, `mixed-${index}`, 100 + index),
      );
      const summary = summarizeTabObservation(state);
      expect(summary.requestCounts).toMatchObject({
        total: 2,
        blocked: 1,
        allowed: 1,
      });
      expect(summary.hostCounts.mixed).toBe(1);
      expect(summary.rows[0].isMixed).toBe(true);
    }
  });

  it("keeps unsupported actions reviewable and non-packaged", () => {
    const excluded = Object.entries(capabilities.excludedNetworkRuleSamples)
      .flatMap(([category, samples]) =>
        samples.map((sample) => ({ category, sample })),
      );
    const unsupported = capabilities.unsupportedSamples.map(
      ({ category, filter }) => ({ category, sample: filter }),
    );
    for (const fixture of corpus.unsupportedCases) {
      expect(
        [...excluded, ...unsupported],
        `${fixture.id} must remain visible in the capability report`,
      ).toContainEqual({ category: fixture.category, sample: fixture.sample });
    }
  });

  it("scrubs identifying inputs and never places them in durable settings", () => {
    const base = required("type-screen13-positive");
    const state = createTabObservationState(1, "https://publisher.test/");
    recordObservedRequest(
      state,
      {
        requestId: "privacy",
        tabId: 1,
        frameId: 0,
        pageUrl: "https://publisher.test/",
        documentUrl: "https://publisher.test/article",
        requestUrl:
          "https://screen13.com/users/person%40example.test/550e8400-e29b-41d4-a716-446655440000/pixel.png?token=private-value",
        requestType: "image",
        timestamp: 100,
      },
      { decision: { ...base.easyPrivacy, requestId: "privacy" } },
    );
    const serialized = JSON.stringify({
      summary: summarizeTabObservation(state),
      durable: normalizeSettings({}),
    });
    for (const forbidden of [
      "person%40example.test",
      "550e8400-e29b-41d4-a716-446655440000",
      "private-value",
      "token=",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports identical-input coverage without functional-negative regressions", () => {
    const results = [...evaluated.values()];
    const report = {
      artifact: corpus.reviewedArtifact,
      fixtures: {
        ordinaryBlocks: group("ordinary-block").length,
        exceptions: group("exception").length,
        typeConstraintPairs: group("type-positive").length,
        sourceConstraintPairs: group("source-positive").length,
        firstPartyPathPairs: group("first-party-positive").length,
        mainFrameAutomaticBypasses: group("main-frame-boundary").length,
        catalogFallbacks: 2,
        precedenceCases: 5,
        engineFallbackStates: 2,
        redirectSequences: 2,
        mixedHostSequences: 2,
        unsupportedRules: corpus.unsupportedCases.length,
        privacyCases: 1,
      },
      catalogOnly: summarizeDecisions(results.map(({ catalog }) => catalog)),
      easyPrivacy: {
        ...summarizeDecisions(results.map(({ easyPrivacy }) => easyPrivacy)),
        exceptions: results.filter(({ match }) => match.outcome === "exception")
          .length,
        catalogFallbacks: 2,
        firstPartyMatches: results.filter(
          ({ easyPrivacy, match }) =>
            easyPrivacy.relationship === "first-party" &&
            (match.outcome === "block" || match.outcome === "exception"),
        ).length,
        mixedHosts: 2,
        unsupportedNonEnforceable: corpus.unsupportedCases.length,
        functionalNegativeRegressions: results.filter(
          ({ fixture, easyPrivacy }) =>
            fixture.groups.includes("functional-negative") &&
            easyPrivacy.action !== "allow",
        ).length,
      },
    };

    expect(report.easyPrivacy.functionalNegativeRegressions).toBe(0);
    expect(report.easyPrivacy.blockedRequests).toBeGreaterThan(
      report.catalogOnly.blockedRequests,
    );
    process.stdout.write(
      `EasyPrivacy Phase 5 coverage report\n${JSON.stringify(report, null, 2)}\n`,
    );
  });
});

function group(name: string) {
  return corpus.requests.filter(({ groups }) => groups.includes(name));
}

function expectPairs(positive: string, negative: string, minimum: number) {
  const positives = group(positive);
  const negatives = group(negative);
  expect(positives).toHaveLength(minimum);
  expect(negatives).toHaveLength(minimum);
  expect(new Set(positives.map(({ pair }) => pair))).toEqual(
    new Set(negatives.map(({ pair }) => pair)),
  );
}

function required(id: string) {
  const result = evaluated.get(id);
  if (!result) throw new Error(`Missing evaluated fixture ${id}.`);
  return result;
}

function contextFor(fixture: CoverageFixture) {
  return normalizeRequestContext({
    requestId: fixture.id,
    tabId: 1,
    pageUrl: fixture.pageUrl,
    documentUrl: fixture.documentUrl,
    requestUrl: fixture.url,
    requestType: fixture.type,
  });
}

function recordDecision(
  state: ReturnType<typeof createTabObservationState>,
  result: ReturnType<typeof required>,
  requestId: string,
  timestamp: number,
) {
  recordObservedRequest(
    state,
    {
      requestId,
      tabId: state.tabId,
      frameId: 0,
      pageUrl: result.fixture.pageUrl,
      documentUrl: result.fixture.documentUrl,
      requestUrl: result.fixture.url,
      requestType: result.fixture.type,
      timestamp,
    },
    { decision: { ...result.easyPrivacy, requestId, tabId: state.tabId } },
  );
}

function summarizeDecisions(decisions: RequestDecision[]) {
  return {
    blockedRequests: decisions.filter(({ action }) => action === "block").length,
    blockedHosts: new Set(
      decisions
        .filter(({ action }) => action === "block")
        .map(({ requestHost }) => requestHost)
        .filter(Boolean),
    ).size,
    allowedRequests: decisions.filter(({ action }) => action === "allow").length,
  };
}
