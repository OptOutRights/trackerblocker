export interface ActionBadgePresentation {
  text: string;
  title: string;
}

export type ActionBadgeState =
  | { status: "available"; blockedCount: number }
  | { status: "paused"; blockedCount: null }
  | { status: "unavailable"; blockedCount: null };

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
    text: String(blockedRequestCount),
    title: `TrackerBlocker - ${blockedRequestCount} ${
      blockedRequestCount === 1 ? "request" : "requests"
    } blocked`,
  };
}

export function formatActionBadgeState(
  state: ActionBadgeState,
): ActionBadgePresentation {
  if (state.status === "paused") {
    return { text: "", title: "TrackerBlocker - protection paused" };
  }

  if (state.status === "unavailable") {
    return {
      text: "!",
      title: "TrackerBlocker - blocked count unavailable",
    };
  }

  return formatActionBadge(state.blockedCount);
}

export class ActionBadgeUpdateQueue {
  private readonly appliedPresentations = new Map<number, string>();
  private readonly queues = new Map<number, Promise<void>>();
  private readonly tabTokens = new Map<number, object>();

  update(
    tabId: number,
    state: ActionBadgeState,
    apply: ApplyActionBadge,
  ): Promise<void> {
    const presentation = formatActionBadgeState(state);
    const presentationKey = `${presentation.text}\u0000${presentation.title}`;
    const token = this.getTabToken(tabId);
    const previous = this.queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      if (
        this.tabTokens.get(tabId) !== token ||
        this.appliedPresentations.get(tabId) === presentationKey
      ) {
        return;
      }

      await apply(presentation);

      if (this.tabTokens.get(tabId) === token) {
        this.appliedPresentations.set(tabId, presentationKey);
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
    this.appliedPresentations.delete(tabId);
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
