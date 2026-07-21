import { describe, expect, it } from "vitest";

import {
  TabPageUrlCache,
  isStaleTopLevelDocumentRequest,
} from "./tabPageUrls";

describe("isStaleTopLevelDocumentRequest", () => {
  it("detects a late request from the previous top-level document", () => {
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 0,
        currentDocumentUrls: [
          "https://publisher.test/probe/current?run=2",
        ],
        documentUrl: "https://publisher.test/probe/previous?run=1",
      }),
    ).toBe(true);
  });

  it("keeps requests from the current top-level document", () => {
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 0,
        currentDocumentUrls: [
          "https://publisher.test/probe/current#section",
        ],
        documentUrl: "https://publisher.test/probe/current",
      }),
    ).toBe(false);
  });

  it("keeps requests from an earlier URL of the current document", () => {
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 0,
        currentDocumentUrls: [
          "https://publisher.test/probe/original",
          "https://publisher.test/probe/pushed-state",
        ],
        documentUrl: "https://publisher.test/probe/original",
      }),
    ).toBe(false);
  });

  it("does not infer staleness for frames or incomplete context", () => {
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 4,
        currentDocumentUrls: ["https://publisher.test/current"],
        documentUrl: "https://frame.test/previous",
      }),
    ).toBe(false);
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 0,
        currentDocumentUrls: ["https://publisher.test/current"],
      }),
    ).toBe(false);
    expect(
      isStaleTopLevelDocumentRequest({
        frameId: 0,
        currentDocumentUrls: ["about:blank"],
        documentUrl: "https://publisher.test/previous",
      }),
    ).toBe(false);
  });
});

describe("TabPageUrlCache", () => {
  it("tracks same-document URL aliases until a full navigation", () => {
    const cache = new TabPageUrlCache();

    cache.set(12, "https://publisher.test/original");
    cache.setSameDocument(12, "https://publisher.test/pushed-state");
    expect(cache.getCurrentDocumentUrls(12)).toEqual([
      "https://publisher.test/original",
      "https://publisher.test/pushed-state",
    ]);

    cache.set(12, "https://publisher.test/new-document");
    expect(cache.getCurrentDocumentUrls(12)).toEqual([
      "https://publisher.test/new-document",
    ]);
  });

  it("resolves and caches the authoritative top-level tab URL", async () => {
    const cache = new TabPageUrlCache();
    let loads = 0;
    const load = async () => {
      loads += 1;
      return "https://publisher.test/article";
    };

    await expect(cache.resolve(12, load)).resolves.toBe(
      "https://publisher.test/article",
    );
    await expect(cache.resolve(12, load)).resolves.toBe(
      "https://publisher.test/article",
    );
    expect(loads).toBe(1);
  });

  it("does not let a cold lookup overwrite a newer navigation", async () => {
    const cache = new TabPageUrlCache();
    let finishLoad: ((url: string) => void) | undefined;
    const pending = cache.resolve(
      12,
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );

    await Promise.resolve();
    cache.set(12, "https://current.test/");
    finishLoad?.("https://stale.test/");

    await expect(pending).resolves.toBe("https://current.test/");
    expect(cache.get(12)).toBe("https://current.test/");
  });

  it("does not restore a URL after the tab is removed", async () => {
    const cache = new TabPageUrlCache();
    let finishLoad: ((url: string) => void) | undefined;
    const pending = cache.resolve(
      12,
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );

    await Promise.resolve();
    cache.remove(12);
    finishLoad?.("https://closed.test/");

    await expect(pending).resolves.toBeNull();
    expect(cache.get(12)).toBeNull();
  });

  it("uses a newer navigation when the cold lookup fails", async () => {
    const cache = new TabPageUrlCache();
    let failLoad: ((error: Error) => void) | undefined;
    const pending = cache.resolve(
      12,
      () =>
        new Promise((_resolve, reject) => {
          failLoad = reject;
        }),
    );

    await Promise.resolve();
    cache.set(12, "https://current.test/");
    failLoad?.(new Error("stale tab lookup"));

    await expect(pending).resolves.toBe("https://current.test/");
    expect(cache.get(12)).toBe("https://current.test/");
  });
});
