import { describe, expect, it } from "vitest";

import { TabPageUrlCache } from "./tabPageUrls";

describe("TabPageUrlCache", () => {
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
