import type { RequestHeaderRestriction } from "./requestDecisions";

export function applyRequestHeaderRestriction<T extends { name: string }>(
  requestHeaders: T[],
  restriction: RequestHeaderRestriction | null,
): T[] {
  if (!restriction) {
    return requestHeaders;
  }

  const names: ReadonlySet<string> = new Set(restriction.removeHeaders);

  return requestHeaders.filter(
    (header) => !names.has(header.name.toLowerCase()),
  );
}

export function stripTrackingRequestHeaders<T extends { name: string }>(
  requestHeaders: T[],
): T[] {
  return applyRequestHeaderRestriction(requestHeaders, {
    removeHeaders: ["cookie", "referer"],
  });
}
