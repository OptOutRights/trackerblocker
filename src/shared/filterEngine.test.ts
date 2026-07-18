import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FilterEngine } from "./filterEngine";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(
  /\/$/,
  "",
);

async function readCommittedArtifact() {
  const [artifact, metadataText] = await Promise.all([
    readFile(new URL("../../public/filter-data/easyprivacy.engine", import.meta.url)),
    readFile(
      new URL(
        "../../public/filter-data/easyprivacy.metadata.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  return {
    artifact: new Uint8Array(artifact),
    metadata: JSON.parse(metadataText) as Record<string, unknown>,
  };
}

describe("FilterEngine", () => {
  it("reports loading until the validated packaged artifact is ready", async () => {
    const engine = new FilterEngine();

    expect(engine.health).toBe("loading");
    expect(
      engine.match({
        requestId: "loading-request",
        tabId: 1,
        url: "https://www.google-analytics.com/g/collect",
        sourceUrl: "https://publisher.test/",
        type: "xmlhttprequest",
      }),
    ).toEqual({
      outcome: "unavailable",
      health: "loading",
      matchedFilter: null,
      matchedException: null,
    });

    await engine.initialize(readCommittedArtifact);

    expect(engine.health).toBe("ready");
    expect(engine.degradedReason).toBeNull();
  });

  it("returns TrackerBlocker-owned block, exception, and no-match evidence", async () => {
    const engine = new FilterEngine();
    await engine.initialize(readCommittedArtifact);

    const blocked = engine.match({
      requestId: "blocked-request",
      tabId: 1,
      url: "https://www.google-analytics.com/g/collect?v=2",
      sourceUrl: "https://publisher.test/",
      type: "xmlhttprequest",
    });
    const excepted = engine.match({
      requestId: "excepted-request",
      tabId: 1,
      url: "https://bam.nr-data.net/1/events",
      sourceUrl: "https://abema.tv/",
      type: "xmlhttprequest",
    });
    const allowed = engine.match({
      requestId: "allowed-request",
      tabId: 1,
      url: "https://publisher.test/assets/app.js",
      sourceUrl: "https://publisher.test/",
      type: "script",
    });
    const websocket = engine.match({
      requestId: "websocket-request",
      tabId: 1,
      url: "wss://metrics.duckdns.org/socket",
      sourceUrl: "https://publisher.test/",
      type: "websocket",
    });

    expect(blocked).toMatchObject({
      outcome: "block",
      health: "ready",
      matchedException: null,
    });
    expect(blocked.matchedFilter?.id).toMatch(/^easyprivacy:[0-9a-f]{8}$/);
    expect(excepted).toMatchObject({
      outcome: "exception",
      health: "ready",
    });
    expect(excepted.matchedFilter?.id).toMatch(/^easyprivacy:[0-9a-f]{8}$/);
    expect(excepted.matchedException?.id).toMatch(
      /^easyprivacy:[0-9a-f]{8}$/,
    );
    expect(allowed).toEqual({
      outcome: "no-match",
      health: "ready",
      matchedFilter: null,
      matchedException: null,
    });
    expect(websocket.outcome).toBe("block");
  });

  it("maps unknown request types safely and ignores unsupported URL schemes", async () => {
    const engine = new FilterEngine();
    await engine.initialize(readCommittedArtifact);

    expect(
      engine.match({
        requestId: "unknown-type",
        tabId: 1,
        url: "https://publisher.test/assets/app.js",
        sourceUrl: "https://publisher.test/",
        type: "future-browser-type",
      }).outcome,
    ).toBe("no-match");
    expect(
      engine.match({
        requestId: "unsupported-scheme",
        tabId: 1,
        url: "data:text/plain,hello",
        sourceUrl: "https://publisher.test/",
        type: "other",
      }).outcome,
    ).toBe("no-match");
  });

  it("degrades without exposing a partial engine when loading fails", async () => {
    const engine = new FilterEngine();

    await engine.initialize(async () => {
      throw new Error("missing packaged file");
    });

    expect(engine.health).toBe("degraded");
    expect(engine.degradedReason).toBe("artifact-load-failed");
    expect(
      engine.match({
        requestId: "degraded-request",
        tabId: 1,
        url: "https://www.google-analytics.com/g/collect",
        sourceUrl: "https://publisher.test/",
        type: "xmlhttprequest",
      }).outcome,
    ).toBe("unavailable");
  });

  it("rejects stale metadata, checksums, capabilities, and malformed bytes", async () => {
    const cases = [
      async () => {
        const loaded = await readCommittedArtifact();
        return {
          ...loaded,
          metadata: { ...loaded.metadata, artifactBytes: 1 },
        };
      },
      async () => {
        const loaded = await readCommittedArtifact();
        return {
          ...loaded,
          metadata: { ...loaded.metadata, artifactSha256: "0".repeat(64) },
        };
      },
      async () => {
        const loaded = await readCommittedArtifact();
        return {
          ...loaded,
          metadata: {
            ...loaded.metadata,
            enabledCapabilities: ["network-block", "redirect"],
          },
        };
      },
      async () => {
        const loaded = await readCommittedArtifact();
        const artifact = loaded.artifact.slice();
        artifact[0] ^= 0xff;
        return { ...loaded, artifact };
      },
    ];

    for (const load of cases) {
      const engine = new FilterEngine();
      await engine.initialize(load);
      expect(engine.health).toBe("degraded");
      expect(engine.degradedReason).toBe("artifact-invalid");
    }
  });

  it("deduplicates repeated initialization", async () => {
    const engine = new FilterEngine();
    let loadCount = 0;
    const load = async () => {
      loadCount += 1;
      return readCommittedArtifact();
    };

    await Promise.all([engine.initialize(load), engine.initialize(load)]);

    expect(loadCount).toBe(1);
    expect(engine.health).toBe("ready");
  });
});

describe("Ghostery production import boundary", () => {
  it("keeps Ghostery imports inside the FilterEngine adapter", async () => {
    const files = await listTypeScriptFiles(`${PROJECT_ROOT}/src`);
    const importers: string[] = [];

    for (const file of files) {
      if (file.endsWith(".test.ts") || file.endsWith(".d.ts")) {
        continue;
      }

      if ((await readFile(file, "utf8")).includes("@ghostery/adblocker")) {
        importers.push(file.slice(PROJECT_ROOT.length + 1));
      }
    }

    expect(importers).toEqual(["src/shared/filterEngine.ts"]);
  });
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = `${directory}/${entry.name}`;

      return entry.isDirectory()
        ? listTypeScriptFiles(path)
        : Promise.resolve(path.endsWith(".ts") || path.endsWith(".tsx")
            ? [path]
            : []);
    }),
  );

  return files.flat().sort();
}
