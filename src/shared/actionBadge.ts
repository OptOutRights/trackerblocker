export interface ActionBadgePresentation {
  text: string;
  title: string;
}

export type ApplyActionBadge = (
  presentation: ActionBadgePresentation,
) => Promise<void>;

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

export class ActionBadgeUpdateQueue {
  private readonly appliedCounts = new Map<number, number>();
  private readonly queues = new Map<number, Promise<void>>();
  private readonly tabTokens = new Map<number, object>();

  update(
    tabId: number,
    blockedSiteCount: number,
    apply: ApplyActionBadge,
  ): Promise<void> {
    const token = this.getTabToken(tabId);
    const previous = this.queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (
        this.tabTokens.get(tabId) !== token ||
        this.appliedCounts.get(tabId) === blockedSiteCount
      ) {
        return;
      }

      await apply(formatActionBadge(blockedSiteCount));

      if (this.tabTokens.get(tabId) === token) {
        this.appliedCounts.set(tabId, blockedSiteCount);
      }
    });

    this.queues.set(tabId, next);

    return next.finally(() => {
      if (this.queues.get(tabId) === next) {
        this.queues.delete(tabId);
      }
    });
  }

  remove(tabId: number): void {
    this.appliedCounts.delete(tabId);
    this.tabTokens.delete(tabId);
  }

  private getTabToken(tabId: number): object {
    const existing = this.tabTokens.get(tabId);

    if (existing) {
      return existing;
    }

    const token = {};
    this.tabTokens.set(tabId, token);
    return token;
  }
}
