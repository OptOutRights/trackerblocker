import { describe, expect, it } from "vitest";

import { startBackgroundRuntime } from "./backgroundStartup";

describe("startBackgroundRuntime", () => {
  it("registers every listener group before initialization begins", () => {
    const order: string[] = [];

    startBackgroundRuntime({
      registerListeners: () => order.push("listeners"),
      startSettings: () => order.push("settings"),
      startFilterEngine: () => order.push("filter-engine"),
      initializeBadge: () => order.push("badge"),
    });

    expect(order).toEqual([
      "listeners",
      "settings",
      "filter-engine",
      "badge",
    ]);
  });
});
