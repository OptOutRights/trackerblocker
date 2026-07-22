import { describe, expect, it } from "vitest";

import {
  ActionBadgeUpdateQueue,
  formatActionBadge,
  formatActionBadgeState,
} from "./actionBadge";

describe("formatActionBadge", () => {
  it("shows the exact count in both the badge and title", () => {
    expect(formatActionBadge(1)).toEqual({
      text: "1",
      title: "TrackerBlocker - 1 request blocked",
    });
    expect(formatActionBadge(99)).toEqual({
      text: "99",
      title: "TrackerBlocker - 99 requests blocked",
    });
    expect(formatActionBadge(100)).toEqual({
      text: "100",
      title: "TrackerBlocker - 100 requests blocked",
    });
    expect(formatActionBadge(101)).toEqual({
      text: "101",
      title: "TrackerBlocker - 101 requests blocked",
    });
    expect(formatActionBadge(12_345)).toEqual({
      text: "12345",
      title: "TrackerBlocker - 12345 requests blocked",
    });
  });
});

describe("formatActionBadgeState", () => {
  it("distinguishes zero from paused and unavailable", () => {
    expect(
      formatActionBadgeState({ status: "available", blockedCount: 0 }),
    ).toEqual({ text: "", title: "TrackerBlocker" });
    expect(
      formatActionBadgeState({ status: "paused", blockedCount: null }),
    ).toEqual({ text: "", title: "TrackerBlocker - protection paused" });
    expect(
      formatActionBadgeState({ status: "unavailable", blockedCount: null }),
    ).toEqual({
      text: "!",
      title: "TrackerBlocker - blocked count unavailable",
    });
  });
});

describe("ActionBadgeUpdateQueue", () => {
  it("applies per-tab updates in order and skips duplicate counts", async () => {
    const queue = new ActionBadgeUpdateQueue();
    const applied: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.update(1, { status: "available", blockedCount: 1 }, async (badge) => {
      applied.push(badge.text);
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });

    await Promise.resolve();
    const second = queue.update(1, { status: "available", blockedCount: 2 }, async (badge) => {
      applied.push(badge.text);
    });
    await Promise.resolve();

    expect(applied).toEqual(["1"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    await queue.update(1, { status: "available", blockedCount: 2 }, async (badge) => {
      applied.push(badge.text);
    });

    expect(applied).toEqual(["1", "2"]);
  });

  it("retries a count when the browser update fails", async () => {
    const queue = new ActionBadgeUpdateQueue();
    let attempts = 0;

    await expect(
      queue.update(1, { status: "available", blockedCount: 3 }, async () => {
        attempts += 1;
        throw new Error("action unavailable");
      }),
    ).rejects.toThrow("action unavailable");
    await queue.update(1, { status: "available", blockedCount: 3 }, async () => {
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
    const active = queue.update(1, { status: "available", blockedCount: 1 }, async (badge) => {
      markActiveStarted?.();
      await new Promise<void>((resolve) => {
        releaseActive = resolve;
      });
      applied.push(`old:${badge.text}`);
    });

    await activeStarted;
    const stale = queue.update(1, { status: "available", blockedCount: 2 }, async (badge) => {
      applied.push(`stale:${badge.text}`);
    });
    queue.remove(1);
    const current = queue.update(1, { status: "available", blockedCount: 3 }, async (badge) => {
      applied.push(`new:${badge.text}`);
    });

    await Promise.resolve();
    expect(applied).toEqual([]);
    releaseActive?.();
    await Promise.all([active, stale, current]);

    expect(applied).toEqual(["old:1", "new:3"]);
  });
});
