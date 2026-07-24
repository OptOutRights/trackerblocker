import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_PATH,
  CAPABILITIES_PATH,
  METADATA_PATH,
  PROJECT_ROOT,
  SOURCE_MANIFEST_PATH,
  SOURCE_PATH,
  buildEasyPrivacyOutputs,
  compileSupportedNetworkEngine,
  createSourceManifest,
  createUpdateSummary,
  createUpdatedSourceManifest,
  inventoryFilterList,
  readCommittedInputs,
  validateEasyPrivacySource,
  validateSourceManifest,
} from "./lib.mjs";

describe("EasyPrivacy source supply chain", () => {
  it("ties the retained source to its acquisition manifest", async () => {
    const { source, sourceManifest } = await readCommittedInputs();
    const validated = validateSourceManifest(source, sourceManifest);

    expect(validated.sourceSha256).toBe(sourceManifest.sourceSha256);
    expect(validated.header.commit).toBe(sourceManifest.upstreamCommit);
    expect(createSourceManifest(source, sourceManifest.retrievedAt)).toEqual(
      sourceManifest,
    );
  });

  it("rejects stale source provenance", async () => {
    const { source, sourceManifest } = await readCommittedInputs();

    expect(() =>
      validateSourceManifest(source, {
        ...sourceManifest,
        sourceSha256: "0".repeat(64),
      }),
    ).toThrow(/sourceSha256 is stale/);
  });

  it("preserves acquisition time when an update returns identical bytes", async () => {
    const { source, sourceManifest } = await readCommittedInputs();
    const next = createUpdatedSourceManifest(
      source,
      "2099-01-01T00:00:00.000Z",
      sourceManifest,
    );

    expect(next).toEqual(sourceManifest);
  });

  it("reports offsetting block and exception deltas separately", () => {
    const summary = createUpdateSummary(
      { ruleCounts: { packagedNetworkRules: 10 } },
      {
        networkRuleCounts: {
          "supported-block": 6,
          "supported-exception": 4,
        },
      },
      { ruleCounts: { packagedNetworkRules: 10 } },
      {
        networkRuleCounts: {
          "supported-block": 7,
          "supported-exception": 3,
        },
        unsupportedModifierCounts: {},
        unsupportedSamples: [],
      },
    );

    expect(summary.rules.packagedNetworkRules.delta).toBe(0);
    expect(summary.supportedNetworkRuleCounts).toEqual({
      "supported-block": { previous: 6, next: 7, delta: 1 },
      "supported-exception": { previous: 4, next: 3, delta: -1 },
    });
  });

  it("rejects an unexpected source identity", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");

    expect(() =>
      validateEasyPrivacySource(
        source.replace("! Title: EasyPrivacy", "! Title: Other"),
      ),
    ).toThrow(/unexpected title/);
  });

  it("inventories unsupported modifiers without an opaque fallback", () => {
    const inventory = inventoryFilterList(
      "||tracker.test^$method=POST\n||redirect.test^$rewrite=abp-resource:blank-js",
    );

    expect(inventory.report.unsupportedModifierCounts).toEqual({
      "request-method": 1,
      redirect: 1,
    });
    expect(inventory.report.unsupportedSamples).toHaveLength(2);
  });

  it("refuses to compile preprocessor-controlled rules", () => {
    expect(() =>
      compileSupportedNetworkEngine(
        "!#if env_firefox\n||tracker.test^\n!#endif",
      ),
    ).toThrow(/preprocessors are not supported/);
  });

  it("rebuilds every committed output byte-for-byte", async () => {
    const [{ source, sourceManifest }, artifact, metadata, capabilities] =
      await Promise.all([
        readCommittedInputs(),
        readFile(ARTIFACT_PATH),
        readFile(METADATA_PATH, "utf8"),
        readFile(CAPABILITIES_PATH, "utf8"),
      ]);
    const rebuilt = await buildEasyPrivacyOutputs(source, sourceManifest);

    expect(rebuilt.artifact.equals(artifact)).toBe(true);
    expect(rebuilt.metadataText).toBe(metadata);
    expect(rebuilt.capabilitiesText).toBe(capabilities);
  });

  it("keeps retained provenance at stable repository paths", () => {
    expect(SOURCE_PATH.endsWith("vendor/easyprivacy/easyprivacy.txt")).toBe(true);
    expect(
      CAPABILITIES_PATH.endsWith(
        "vendor/easyprivacy/easyprivacy.capabilities.json",
      ),
    ).toBe(true);
    expect(SOURCE_MANIFEST_PATH.endsWith("vendor/easyprivacy/source.json")).toBe(
      true,
    );
  });

  it("keeps shipped notices aligned with every locked production package", async () => {
    const [notice, packageLockText] = await Promise.all([
      readFile(`${PROJECT_ROOT}/public/THIRD-PARTY-NOTICES.txt`, "utf8"),
      readFile(`${PROJECT_ROOT}/package-lock.json`, "utf8"),
    ]);
    const packageLock = JSON.parse(packageLockText);

    const productionPackages = Object.entries(packageLock.packages).filter(
      ([packagePath, details]) =>
        packagePath.startsWith("node_modules/") && details.dev !== true,
    );
    const productionPackageByName = new Map(
      productionPackages.map(([packagePath, details]) => [
        packagePath.slice(packagePath.lastIndexOf("node_modules/") + 13),
        details,
      ]),
    );

    expect(productionPackages.length).toBeGreaterThan(0);
    for (const [packagePath, details] of productionPackages) {
      const name = packagePath.slice(
        packagePath.lastIndexOf("node_modules/") + 13,
      );

      expect(details.version).toBeTypeOf("string");
      expect(details.integrity).toMatch(/^sha512-/);
      expect(notice).toContain(`Package: ${name}@${details.version}`);
      expect(notice).toContain(`Integrity: ${details.integrity}`);
    }

    expect(notice).toContain("GNU General Public License version 3 or later");
    expect(notice).toContain("Mozilla Public License version 2.0");
    expect(notice).toContain(
      "The name(s) of the Copyright Holder(s) or the Author(s) of the Font Software",
    );
    expect(notice).toContain("Work: Parser code based on Parsel");
    expect(notice).toContain("Copyright (c) 2020 Lea Verou");
    const extendedSelectors = productionPackageByName.get(
      "@ghostery/adblocker-extended-selectors",
    );
    expect(extendedSelectors?.version).toBeTypeOf("string");
    expect(notice).toContain(
      `Embedded through: @ghostery/adblocker-extended-selectors@${extendedSelectors.version}`,
    );
    expect(notice).toContain("Work: Public Suffix List");
    expect(notice).toContain(
      "Upstream source: https://publicsuffix.org/list/public_suffix_list.dat",
    );
    const tldts = productionPackageByName.get("tldts");
    const tldtsExperimental = productionPackageByName.get("tldts-experimental");
    expect(tldts?.version).toBeTypeOf("string");
    expect(tldtsExperimental?.version).toBeTypeOf("string");
    expect(notice).toContain(
      `Embedded through: tldts@${tldts.version} and tldts-experimental@${tldtsExperimental.version}`,
    );
  });
});
