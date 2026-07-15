import { classifyRequestSiteRelationship } from "./domains";
import { decideRule, type DomainOverrideAction } from "./ruleDecisions";
import {
  lookupTrackerCatalogEntry,
  type TrackerCatalogEntry,
} from "./trackerCatalog";

export interface HeaderRestrictionInput {
  pageUrl?: string | null;
  requestUrl?: string | null;
  sitePaused: boolean;
  domainOverrides?: Record<string, DomainOverrideAction>;
  catalog?: readonly TrackerCatalogEntry[];
}

export function decideHeaderRestriction(input: HeaderRestrictionInput) {
  const classification = classifyRequestSiteRelationship({
    pageUrl: input.pageUrl,
    requestUrl: input.requestUrl,
  });

  if (classification.status !== "third-party") {
    return decideRule({
      relationship:
        classification.status === "same-site" ? "first-party" : "unknown",
      sitePaused: input.sitePaused,
    });
  }

  const catalogMatch = lookupTrackerCatalogEntry(
    classification.requestHost,
    input.catalog,
    input.requestUrl,
  );

  return decideRule({
    relationship: "third-party",
    catalogDefaultAction: catalogMatch?.action ?? null,
    domainOverride:
      input.domainOverrides?.[classification.requestHost] ?? null,
    sitePaused: input.sitePaused,
  });
}

export function stripTrackingRequestHeaders<T extends { name: string }>(
  requestHeaders: T[],
): T[] {
  return requestHeaders.filter((header) => {
    const name = header.name.toLowerCase();

    return name !== "cookie" && name !== "referer";
  });
}
