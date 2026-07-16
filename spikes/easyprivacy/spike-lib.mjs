import {
  FiltersEngine,
  Request,
  parseFilters,
} from "@ghostery/adblocker";

export const ENGINE_CONFIG = Object.freeze({
  debug: false,
  enableCompression: true,
  enableHtmlFiltering: false,
  enableInMemoryCache: true,
  enableMutationObserver: false,
  enableOptimizations: true,
  enablePushInjectionsOnNavigationEvents: false,
  guessRequestTypeFromUrl: false,
  integrityCheck: true,
  loadCSPFilters: false,
  loadCosmeticFilters: false,
  loadExceptionFilters: true,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false,
  loadNetworkFilters: true,
  loadPreprocessors: false,
});

const INVENTORY_CONFIG = Object.freeze({
  ...ENGINE_CONFIG,
  enableHtmlFiltering: true,
  loadCSPFilters: true,
  loadCosmeticFilters: true,
  loadExtendedSelectors: true,
  loadGenericCosmeticsFilters: true,
  loadPreprocessors: true,
});

export function classifyNetworkFilter(filter) {
  if (filter.isCSP()) {
    return "csp";
  }

  if (filter.isRedirectRule()) {
    return "redirect-rule";
  }

  if (filter.isRedirect()) {
    return "redirect";
  }

  if (filter.isRemoveParam()) {
    return "removeparam";
  }

  if (filter.isReplace() || filter.isHtmlFilteringRule()) {
    return "response-modification";
  }

  return filter.isException() ? "supported-exception" : "supported-block";
}

export function inventoryFilterList(list) {
  const parsed = parseFilters(list, INVENTORY_CONFIG);
  const networkRuleCounts = {};
  const supportedNetworkFilters = [];

  for (const filter of parsed.networkFilters) {
    const category = classifyNetworkFilter(filter);
    networkRuleCounts[category] = (networkRuleCounts[category] ?? 0) + 1;

    if (category === "supported-block" || category === "supported-exception") {
      supportedNetworkFilters.push(filter);
    }
  }

  const ignoredLineCounts = {
    empty: 0,
    comment: 0,
    adguard: 0,
    unsupported: 0,
  };
  const unsupportedModifierCounts = {};
  const unsupportedSamples = [];

  for (const unsupported of parsed.notSupportedFilters) {
    if (unsupported.filterType === 100) {
      ignoredLineCounts.empty += 1;
      continue;
    }

    if (unsupported.filterType === 101) {
      ignoredLineCounts.comment += 1;
      continue;
    }

    if (unsupported.filterType === 102) {
      ignoredLineCounts.adguard += 1;
    } else {
      ignoredLineCounts.unsupported += 1;
    }

    const modifier = classifyUnsupportedSyntax(unsupported.filter);
    unsupportedModifierCounts[modifier] =
      (unsupportedModifierCounts[modifier] ?? 0) + 1;

    if (unsupportedSamples.length < 20) {
      unsupportedSamples.push({
        lineNumber: unsupported.lineNumber,
        category: modifier,
        filter: unsupported.filter,
      });
    }
  }

  return {
    parsed,
    supportedNetworkFilters,
    report: {
      totalNetworkRules: parsed.networkFilters.length,
      packagedNetworkRules: supportedNetworkFilters.length,
      cosmeticRulesExcluded: parsed.cosmeticFilters.length,
      preprocessors: parsed.preprocessors.length,
      networkRuleCounts: sortRecord(networkRuleCounts),
      ignoredLineCounts,
      unsupportedModifierCounts: sortRecord(unsupportedModifierCounts),
      unsupportedSamples,
    },
  };
}

export function compileSupportedNetworkEngine(list) {
  const inventory = inventoryFilterList(list);

  if (inventory.report.preprocessors !== 0) {
    throw new Error(
      "Preprocessor directives are not supported by the Phase 0 network-only compiler.",
    );
  }

  const engine = new FiltersEngine({
    networkFilters: inventory.supportedNetworkFilters,
    config: ENGINE_CONFIG,
  });

  return { engine, report: inventory.report };
}

export function createRequest({
  requestId = "spike-request",
  tabId = 1,
  url,
  sourceUrl,
  type,
}) {
  return Request.fromRawDetails({
    requestId,
    tabId,
    url,
    sourceUrl,
    type,
  });
}

function classifyUnsupportedSyntax(filter) {
  const modifiers = filter.includes("$")
    ? filter.slice(filter.lastIndexOf("$") + 1).toLowerCase()
    : "";

  if (/\b(removeparam|urltransform|uritransform|urlskip)\b/.test(modifiers)) {
    return "url-transformation";
  }

  if (/\b(redirect|redirect-rule|rewrite)\b/.test(modifiers)) {
    return "redirect";
  }

  if (/\b(csp|permissions|header)\b/.test(modifiers)) {
    return "response-or-header-modification";
  }

  if (/\b(replace|html)\b/.test(modifiers)) {
    return "response-body-modification";
  }

  return "other";
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}
