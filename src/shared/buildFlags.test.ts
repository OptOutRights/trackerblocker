import { describe, expect, it } from "vitest";

import { isEasyPrivacyMatchingEnabled } from "./buildFlags";

describe("EasyPrivacy build flag", () => {
  it("is enabled only by the explicit true string", () => {
    expect(isEasyPrivacyMatchingEnabled("true")).toBe(true);
    expect(isEasyPrivacyMatchingEnabled("false")).toBe(false);
    expect(isEasyPrivacyMatchingEnabled(true)).toBe(false);
    expect(isEasyPrivacyMatchingEnabled(undefined)).toBe(false);
  });
});
