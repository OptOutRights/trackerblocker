import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FiltersEngine } from "@ghostery/adblocker";
import { describe, expect, it } from "vitest";

import {
  compileSupportedNetworkEngine,
  createRequest,
  inventoryFilterList,
} from "./spike-lib.mjs";

const SPIKE_DIR = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_PATH = resolve(SPIKE_DIR, "fixtures/synthetic.txt");

describe("Ghostery network-rule compatibility", () => {
  it("handles blocking, exceptions, source constraints, request types, and first-party paths", async () => {
    const fixture = await readFile(SYNTHETIC_PATH, "utf8");
    const { engine } = compileSupportedNetworkEngine(fixture);

    expectMatch(engine, {
      url: "https://tracker.test/pixel.js",
      sourceUrl: "https://publisher.test/",
      type: "script",
    });
    expectException(engine, {
      url: "https://tracker.test/allowed.js",
      sourceUrl: "https://publisher.test/",
      type: "script",
    });
    expectMatch(engine, {
      url: "https://source.test/collect",
      sourceUrl: "https://publisher.test/",
      type: "xmlhttprequest",
    });
    expectNoMatch(engine, {
      url: "https://source.test/collect",
      sourceUrl: "https://other.test/",
      type: "xmlhttprequest",
    });
    expectMatch(engine, {
      url: "https://type.test/pixel",
      sourceUrl: "https://publisher.test/",
      type: "image",
    });
    expectNoMatch(engine, {
      url: "https://type.test/pixel",
      sourceUrl: "https://publisher.test/",
      type: "script",
    });
    expectMatch(engine, {
      url: "https://publisher.test/tracking/collect",
      sourceUrl: "https://publisher.test/",
      type: "xmlhttprequest",
    });
  });

  it("excludes action rules that TrackerBlocker cannot safely treat as cancellation", async () => {
    const fixture = await readFile(SYNTHETIC_PATH, "utf8");
    const inventory = inventoryFilterList(fixture);
    const { engine } = compileSupportedNetworkEngine(fixture);

    expect(inventory.report.networkRuleCounts).toMatchObject({
      csp: 1,
      redirect: 1,
      "redirect-rule": 1,
      removeparam: 1,
      "response-modification": 1,
      "supported-block": 4,
      "supported-exception": 1,
    });
    expect(inventory.report.packagedNetworkRules).toBe(5);

    for (const host of [
      "redirect.test",
      "redirect-rule.test",
      "params.test",
      "replace.test",
      "csp.test",
    ]) {
      expectNoMatch(engine, {
        url: `https://${host}/resource.js?utm_source=test`,
        sourceUrl: "https://publisher.test/",
        type: "script",
      });
    }
  });

  it("preserves decisions through serialization and deserialization", async () => {
    const fixture = await readFile(SYNTHETIC_PATH, "utf8");
    const { engine } = compileSupportedNetworkEngine(fixture);
    const restored = FiltersEngine.deserialize(engine.serialize());
    const requests = [
      {
        url: "https://tracker.test/pixel.js",
        sourceUrl: "https://publisher.test/",
        type: "script",
      },
      {
        url: "https://tracker.test/allowed.js",
        sourceUrl: "https://publisher.test/",
        type: "script",
      },
      {
        url: "https://publisher.test/tracking/collect",
        sourceUrl: "https://publisher.test/",
        type: "xmlhttprequest",
      },
    ];

    for (const details of requests) {
      const before = summarizeMatch(engine, details);
      const after = summarizeMatch(restored, details);
      expect(after).toEqual(before);
    }
  });
});

function expectMatch(engine, details) {
  const result = engine.match(createRequest(details));
  expect(result.match, JSON.stringify(details)).toBe(true);
  expect(result.filter, JSON.stringify(details)).toBeDefined();
  expect(result.exception, JSON.stringify(details)).toBeUndefined();
  expect(result.redirect, JSON.stringify(details)).toBeUndefined();
  expect(result.rewrite, JSON.stringify(details)).toBeUndefined();
}

function expectException(engine, details) {
  const result = engine.match(createRequest(details));
  expect(result.match, JSON.stringify(details)).toBe(false);
  expect(result.exception, JSON.stringify(details)).toBeDefined();
}

function expectNoMatch(engine, details) {
  const result = engine.match(createRequest(details));
  expect(result.match, JSON.stringify(details)).toBe(false);
  expect(result.exception, JSON.stringify(details)).toBeUndefined();
}

function summarizeMatch(engine, details) {
  const result = engine.match(createRequest(details));

  return {
    match: result.match,
    hasFilter: result.filter !== undefined,
    hasException: result.exception !== undefined,
    hasRedirect: result.redirect !== undefined,
    hasRewrite: result.rewrite !== undefined,
  };
}
