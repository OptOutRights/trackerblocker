import { describe, expect, it } from "vitest";

import { isEasyPrivacyMatchingEnabled } from "./buildFlags";

describe("EasyPrivacy build flag", () => {
  it("defaults on and retains an explicit emergency-off value", () => {
    expect(isEasyPrivacyMatchingEnabled(undefined)).toBe(true);
    expect(isEasyPrivacyMatchingEnabled("true")).toBe(true);
    expect(isEasyPrivacyMatchingEnabled("false")).toBe(false);
    expect(isEasyPrivacyMatchingEnabled(true)).toBe(false);
    expect(isEasyPrivacyMatchingEnabled("")).toBe(false);
    expect(isEasyPrivacyMatchingEnabled("typo")).toBe(false);
  });
});
