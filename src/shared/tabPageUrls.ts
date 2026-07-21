export type LoadTabPageUrl = (
  tabId: number,
) => Promise<string | null | undefined>;

export interface StaleTopLevelDocumentRequestInput {
  frameId: number;
  currentDocumentUrls?: readonly string[];
  documentUrl?: string | null;
}

export function isStaleTopLevelDocumentRequest({
  frameId,
  currentDocumentUrls,
  documentUrl,
}: StaleTopLevelDocumentRequestInput): boolean {
  if (frameId !== 0) {
    return false;
  }

  const normalizedDocumentUrl = normalizeDocumentUrl(documentUrl);
  const normalizedCurrentUrls = new Set(
    (currentDocumentUrls ?? [])
      .map(normalizeDocumentUrl)
      .filter((url): url is string => url !== null),
  );

  return (
    normalizedDocumentUrl !== null &&
    normalizedCurrentUrls.size > 0 &&
    !normalizedCurrentUrls.has(normalizedDocumentUrl)
  );
}

export class TabPageUrlCache {
  readonly #urls = new Map<number, string>();
  readonly #documentUrls = new Map<number, Set<string>>();
  readonly #versions = new Map<number, number>();
  readonly #loads = new Map<number, Promise<string | null>>();

  get(tabId: number): string | null {
    return this.#urls.get(tabId) ?? null;
  }

  set(tabId: number, url: string): void {
    this.#advanceVersion(tabId);

    if (url) {
      this.#urls.set(tabId, url);
      this.#documentUrls.set(tabId, new Set([url]));
    } else {
      this.#urls.delete(tabId);
      this.#documentUrls.delete(tabId);
    }
  }

  setSameDocument(tabId: number, url: string): void {
    this.#advanceVersion(tabId);

    if (!url) {
      this.#urls.delete(tabId);
      this.#documentUrls.delete(tabId);
      return;
    }

    const documentUrls = this.#documentUrls.get(tabId) ?? new Set<string>();
    const previousUrl = this.#urls.get(tabId);

    if (previousUrl) {
      documentUrls.add(previousUrl);
    }
    documentUrls.add(url);
    this.#urls.set(tabId, url);
    this.#documentUrls.set(tabId, documentUrls);
  }

  getCurrentDocumentUrls(tabId: number): readonly string[] {
    return [...(this.#documentUrls.get(tabId) ?? [])];
  }

  remove(tabId: number): void {
    this.#advanceVersion(tabId);
    this.#urls.delete(tabId);
    this.#documentUrls.delete(tabId);
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
          this.#documentUrls.set(tabId, new Set([loadedUrl]));
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

function normalizeDocumentUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}
