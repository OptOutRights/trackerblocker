import { parse } from "tldts";

export type DomainInputRole = "page" | "request";

export type DomainClassification =
  | {
      status: "same-site" | "third-party";
      pageHost: string;
      pageSite: string;
      requestHost: string;
      requestSite: string;
    }
  | {
      status: "ignored";
      reason: "non-web-scheme";
      inputRole: DomainInputRole;
      scheme: string;
    }
  | {
      status: "unclassifiable";
      reason:
        | "missing-url"
        | "malformed-url"
        | "missing-host"
        | "missing-registrable-domain";
      inputRole: DomainInputRole;
    };

export interface ClassifyRequestSiteRelationshipInput {
  pageUrl?: string | null;
  requestUrl?: string | null;
}

type DomainClassificationFailure = Extract<
  DomainClassification,
  { status: "ignored" | "unclassifiable" }
>;

interface ComparableSite {
  host: string;
  site: string;
}

const WEB_SCHEMES = new Set(["http:", "https:", "ws:", "wss:"]);
const EMPTY_WEB_AUTHORITY_PATTERN = /^(?:https?|wss?):\/\/[/?#]/i;
const LOCALHOST = "localhost";

const TLDT_OPTIONS = {
  allowPrivateDomains: true,
  extractHostname: false,
} as const;

export function classifyRequestSiteRelationship({
  pageUrl,
  requestUrl,
}: ClassifyRequestSiteRelationshipInput): DomainClassification {
  const pageSite = getComparableSite(pageUrl, "page");

  if ("status" in pageSite) {
    return pageSite;
  }

  const requestSite = getComparableSite(requestUrl, "request");

  if ("status" in requestSite) {
    return requestSite;
  }

  return {
    status: pageSite.site === requestSite.site ? "same-site" : "third-party",
    pageHost: pageSite.host,
    pageSite: pageSite.site,
    requestHost: requestSite.host,
    requestSite: requestSite.site,
  };
}

export function formatUrlHost(url?: string | null): string | null {
  const parsedUrl = parseUrl(url, "page");

  if ("status" in parsedUrl || !WEB_SCHEMES.has(parsedUrl.protocol)) {
    return null;
  }

  return normalizeHost(parsedUrl.hostname) || null;
}

function getComparableSite(
  url: string | null | undefined,
  inputRole: DomainInputRole,
): ComparableSite | DomainClassificationFailure {
  const parsedUrl = parseUrl(url, inputRole);

  if ("status" in parsedUrl) {
    return parsedUrl;
  }

  if (!WEB_SCHEMES.has(parsedUrl.protocol)) {
    return {
      status: "ignored",
      reason: "non-web-scheme",
      inputRole,
      scheme: parsedUrl.protocol.replace(/:$/, ""),
    };
  }

  const host = normalizeHost(parsedUrl.hostname);

  if (!host) {
    return {
      status: "unclassifiable",
      reason: "missing-host",
      inputRole,
    };
  }

  const parsedHost = parse(host, TLDT_OPTIONS);

  if (parsedHost.isIp || host === LOCALHOST) {
    return {
      host,
      site: host,
    };
  }

  if (!parsedHost.domain) {
    return {
      status: "unclassifiable",
      reason: "missing-registrable-domain",
      inputRole,
    };
  }

  return {
    host,
    site: normalizeHost(parsedHost.domain),
  };
}

function parseUrl(
  url: string | null | undefined,
  inputRole: DomainInputRole,
): URL | Extract<DomainClassification, { status: "unclassifiable" }> {
  if (!url) {
    return {
      status: "unclassifiable",
      reason: "missing-url",
      inputRole,
    };
  }

  if (EMPTY_WEB_AUTHORITY_PATTERN.test(url)) {
    return {
      status: "unclassifiable",
      reason: "missing-host",
      inputRole,
    };
  }

  try {
    return new URL(url);
  } catch {
    return {
      status: "unclassifiable",
      reason: "malformed-url",
      inputRole,
    };
  }
}

function normalizeHost(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return withoutBrackets.toLowerCase().replace(/\.+$/, "");
}
