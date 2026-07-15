import { describe, expect, it } from "vitest";

import { ActionBadgeUpdateQueue, formatActionBadge } from "./actionBadge";

describe("formatActionBadge", () => {
  it("caps visible text while preserving the exact count in the title", () => {
    expect(formatActionBadge(99)).toEqual({
      text: "99",
      title: "TrackerBlocker - 99 sites blocked",
    });
    expect(formatActionBadge(100)).toEqual({
      text: "99+",
      title: "TrackerBlocker - 100 sites blocked",
    });
    expect(formatActionBadge(101)).toEqual({
      text: "99+",
      title: "TrackerBlocker - 101 sites blocked",
    });
  });
});

describe("ActionBadgeUpdateQueue", () => {
  it("applies per-tab updates in order and skips duplicate counts", async () => {
    const queue = new ActionBadgeUpdateQueue();
    const applied: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.update(1, 1, async (badge) => {
      applied.push(badge.text);
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });

    await Promise.resolve();
    const second = queue.update(1, 2, async (badge) => {
      applied.push(badge.text);
    });
    await Promise.resolve();

    expect(applied).toEqual(["1"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    await queue.update(1, 2, async (badge) => {
      applied.push(badge.text);
    });

    expect(applied).toEqual(["1", "2"]);
  });

  it("retries a count when the browser update fails", async () => {
    const queue = new ActionBadgeUpdateQueue();
    let attempts = 0;

    await expect(
      queue.update(1, 3, async () => {
        attempts += 1;
        throw new Error("action unavailable");
      }),
    ).rejects.toThrow("action unavailable");
    await queue.update(1, 3, async () => {
      attempts += 1;
    });

    expect(attempts).toBe(2);
  });

  it("drops queued updates when a removed tab id is reused", async () => {
    const queue = new ActionBadgeUpdateQueue();
    const applied: string[] = [];
    let releaseActive: (() => void) | undefined;
    let markActiveStarted: (() => void) | undefined;
    const activeStarted = new Promise<void>((resolve) => {
      markActiveStarted = resolve;
    });
    const active = queue.update(1, 1, async (badge) => {
      applied.push(`old:${badge.text}`);
      markActiveStarted?.();
      await new Promise<void>((resolve) => {
        releaseActive = resolve;
      });
    });

    await activeStarted;
    const stale = queue.update(1, 2, async (badge) => {
      applied.push(`stale:${badge.text}`);
    });
    queue.remove(1);
    await queue.update(1, 3, async (badge) => {
      applied.push(`new:${badge.text}`);
    });

    releaseActive?.();
    await Promise.all([active, stale]);

    expect(applied).toEqual(["old:1", "new:3"]);
  });
});
