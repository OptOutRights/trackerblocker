export interface ActionBadgePresentation {
  text: string;
  title: string;
}

export type ApplyActionBadge = (
  presentation: ActionBadgePresentation,
) => Promise<void>;

export function formatActionBadge(
  blockedRequestCount: number,
): ActionBadgePresentation {
  if (blockedRequestCount <= 0) {
    return {
      text: "",
      title: "TrackerBlocker",
    };
  }

  return {
    text: blockedRequestCount > 99 ? "99+" : String(blockedRequestCount),
    title: `TrackerBlocker - ${blockedRequestCount} ${
      blockedRequestCount === 1 ? "request" : "requests"
    } blocked`,
  };
}

export class ActionBadgeUpdateQueue {
  private readonly appliedCounts = new Map<number, number>();
  private readonly queues = new Map<number, Promise<void>>();
  private readonly tabTokens = new Map<number, object>();

  update(
    tabId: number,
    blockedRequestCount: number,
    apply: ApplyActionBadge,
  ): Promise<void> {
    const token = this.getTabToken(tabId);
    const previous = this.queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (
        this.tabTokens.get(tabId) !== token ||
        this.appliedCounts.get(tabId) === blockedRequestCount
      ) {
        return;
      }

      await apply(formatActionBadge(blockedRequestCount));

      if (this.tabTokens.get(tabId) === token) {
        this.appliedCounts.set(tabId, blockedRequestCount);
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
