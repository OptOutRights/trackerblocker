export type LoadTabPageUrl = (
  tabId: number,
) => Promise<string | null | undefined>;

export class TabPageUrlCache {
  readonly #urls = new Map<number, string>();
  readonly #versions = new Map<number, number>();
  readonly #loads = new Map<number, Promise<string | null>>();

  get(tabId: number): string | null {
    return this.#urls.get(tabId) ?? null;
  }

  set(tabId: number, url: string): void {
    this.#advanceVersion(tabId);

    if (url) {
      this.#urls.set(tabId, url);
    } else {
      this.#urls.delete(tabId);
    }
  }

  remove(tabId: number): void {
    this.#advanceVersion(tabId);
    this.#urls.delete(tabId);
  }

  resolve(tabId: number, load: LoadTabPageUrl): Promise<string | null> {
    const cached = this.get(tabId);

    if (cached) {
      return Promise.resolve(cached);
    }

    const existing = this.#loads.get(tabId);

    if (existing) {
      return existing;
    }

    const version = this.#versions.get(tabId) ?? 0;
    const pending = Promise.resolve()
      .then(() => load(tabId))
      .then((loadedUrl) => {
        if ((this.#versions.get(tabId) ?? 0) !== version) {
          return this.get(tabId);
        }

        if (loadedUrl) {
          this.#urls.set(tabId, loadedUrl);
          return loadedUrl;
        }

        return null;
      })
      .catch(() => this.get(tabId))
      .finally(() => {
        if (this.#loads.get(tabId) === pending) {
          this.#loads.delete(tabId);
        }
      });

    this.#loads.set(tabId, pending);
    return pending;
  }

  #advanceVersion(tabId: number): void {
    this.#versions.set(tabId, (this.#versions.get(tabId) ?? 0) + 1);
  }
}
