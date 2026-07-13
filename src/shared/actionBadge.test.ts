import { describe, expect, it } from "vitest";

import { formatActionBadge } from "./actionBadge";

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
