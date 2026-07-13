export interface ActionBadgePresentation {
  text: string;
  title: string;
}

export function formatActionBadge(
  blockedSiteCount: number,
): ActionBadgePresentation {
  if (blockedSiteCount <= 0) {
    return {
      text: "",
      title: "TrackerBlocker",
    };
  }

  return {
    text: blockedSiteCount > 99 ? "99+" : String(blockedSiteCount),
    title: `TrackerBlocker - ${blockedSiteCount} ${
      blockedSiteCount === 1 ? "site" : "sites"
    } blocked`,
  };
}
