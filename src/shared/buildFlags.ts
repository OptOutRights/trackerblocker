export function isEasyPrivacyMatchingEnabled(value: unknown): boolean {
  return value === "true";
}

export const EASYPRIVACY_MATCHING_ENABLED = isEasyPrivacyMatchingEnabled(
  import.meta.env.WXT_EASYPRIVACY_MATCHING,
);
