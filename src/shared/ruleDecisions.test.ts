import { describe, expect, it } from "vitest";

import { decideRule } from "./ruleDecisions";

describe("decideRule", () => {
  it("lets site pause take precedence over user and automatic blocking", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: "block",
        domainOverride: "block",
        sitePaused: true,
      }),
    ).toEqual({
      status: "allowed-paused",
      source: "site-paused",
      shouldBlock: false,
    });
  });

  it("lets per-domain block overrides beat catalog defaults", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: "allow",
        domainOverride: "block",
      }),
    ).toEqual({
      status: "blocked",
      source: "blocked-by-user",
      shouldBlock: true,
    });
  });

  it("lets per-domain allow overrides beat catalog defaults", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: "block",
        domainOverride: "allow",
      }),
    ).toEqual({
      status: "allowed",
      source: "allowed-by-user",
      shouldBlock: false,
    });
  });

  it("blocks third parties when the catalog default is block", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: "block",
      }),
    ).toEqual({
      status: "blocked",
      source: "automatic",
      shouldBlock: true,
    });
  });

  it("allows functional third parties when the catalog default is allow", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: "allow",
      }),
    ).toEqual({
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
    });
  });

  it("keeps unknown third parties visible but allowed by default", () => {
    expect(
      decideRule({
        relationship: "third-party",
        catalogDefaultAction: null,
      }),
    ).toEqual({
      status: "unknown",
      source: "automatic",
      shouldBlock: false,
    });
  });

  it("allows first-party requests by default", () => {
    expect(
      decideRule({
        relationship: "first-party",
        catalogDefaultAction: "block",
      }),
    ).toEqual({
      status: "allowed",
      source: "automatic",
      shouldBlock: false,
    });
  });

  it("keeps unclassified requests visible but allowed by default", () => {
    expect(
      decideRule({
        relationship: "unknown",
        catalogDefaultAction: null,
      }),
    ).toEqual({
      status: "unknown",
      source: "automatic",
      shouldBlock: false,
    });
  });
});
