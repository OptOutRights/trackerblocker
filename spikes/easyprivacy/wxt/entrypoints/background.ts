import { FiltersEngine, Request } from "@ghostery/adblocker";
import { browser } from "wxt/browser";

export default defineBackground(() => {
  void loadPackagedEngine();
});

async function loadPackagedEngine(): Promise<void> {
  const startedAt = performance.now();
  const artifactUrl = `${browser.runtime.getURL("/")}filter-data/easyprivacy.engine`;
  const response = await fetch(artifactUrl);

  if (!response.ok) {
    throw new Error(`Packaged EasyPrivacy artifact returned ${response.status}.`);
  }

  const engine = FiltersEngine.deserialize(
    new Uint8Array(await response.arrayBuffer()),
  );
  const smokeResult = engine.match(
    Request.fromRawDetails({
      requestId: "spike-smoke",
      tabId: -1,
      url: "https://www.google-analytics.com/g/collect?v=2&tid=G-TEST",
      sourceUrl: "https://publisher.test/",
      type: "xmlhttprequest",
    }),
  );

  console.info("[EasyPrivacy spike] Packaged engine ready", {
    initializationMs: performance.now() - startedAt,
    representativeRequestMatched: smokeResult.match,
  });
}
