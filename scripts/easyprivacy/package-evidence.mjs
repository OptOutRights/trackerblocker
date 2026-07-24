import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(ROOT, ".output/firefox-mv3");
const packageJson = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  await readFile(path.join(ROOT, "package-lock.json"), "utf8"),
);
const projectLicense = await readFile(path.join(ROOT, "LICENSE"), "utf8");
const outfitLicense = await readFile(
  path.join(ROOT, "node_modules/@fontsource-variable/outfit/LICENSE"),
  "utf8",
);
const extendedSelectorsParser = await readFile(
  path.join(
    ROOT,
    "node_modules/@ghostery/adblocker-extended-selectors/dist/esm/parse.js",
  ),
  "utf8",
);
assert.equal(packageJson.name, "trackerblocker");
assert.equal(typeof packageJson.version, "string");
assert.equal(packageJson.license, "GPL-3.0-or-later");
assert.equal(packageLock.packages?.[""]?.license, packageJson.license);
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const archiveName = `${packageName}-${packageVersion}-firefox.zip`;
const sourceArchiveName = `${packageName}-${packageVersion}-sources.zip`;
const archive = path.join(ROOT, ".output", archiveName);
const sources = path.join(ROOT, ".output", sourceArchiveName);
const maxCatalogOnlyBytes = 400_000;
const temporary = await mkdtemp(path.join(os.tmpdir(), "trackerblocker-package-"));
const fullComparison = path.join(temporary, "with-easyprivacy.zip");
const baselineComparison = path.join(temporary, "catalog-only-baseline.zip");
const ordinaryBuildEnv = { ...process.env };
delete ordinaryBuildEnv.WXT_EASYPRIVACY_MATCHING;

await run(
  "npx",
  ["wxt", "build", "-b", "firefox"],
  ROOT,
  { ...ordinaryBuildEnv, TRACKERBLOCKER_QA_PACKAGE_BASELINE: "true" },
);
await run(
  "zip",
  ["-q", "-r", baselineComparison, ".", "-x", "filter-data/*"],
  output,
);
await run(
  "npm",
  ["run", "zip:firefox"],
  ROOT,
  {
    ...ordinaryBuildEnv,
    TRACKERBLOCKER_QA_PACKAGE_BASELINE: "false",
  },
);
await run("zip", ["-q", "-r", fullComparison, "."], output);
const fullBytes = (await stat(fullComparison)).size;
const baselineBytes = (await stat(baselineComparison)).size;
const deltaBytes = fullBytes - baselineBytes;
const [archiveStats, sourceArchiveStats] = await Promise.all([
  stat(archive),
  stat(sources),
]);
assert(
  baselineBytes < maxCatalogOnlyBytes,
  `The ${baselineBytes}-byte catalog-only counterfactual exceeds the ${maxCatalogOnlyBytes}-byte sanity bound and may still contain EasyPrivacy code.`,
);
assert(deltaBytes > 0 && deltaBytes < 1_500_000);

const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
assert.deepEqual(manifest.permissions, [
  "storage",
  "webNavigation",
  "webRequest",
  "webRequestBlocking",
]);
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
assert.equal("content_scripts" in manifest, false);
assertReleaseIdentity(manifest, "Generated manifest");

const packagedManifest = JSON.parse(
  await capture("unzip", ["-p", archive, "manifest.json"], ROOT),
);
assertReleaseIdentity(packagedManifest, "Packaged manifest");

const firefoxContents = await capture("unzip", ["-Z1", archive], ROOT);
for (const required of [
  "LICENSE",
  "THIRD-PARTY-NOTICES.txt",
  "filter-data/easyprivacy.engine",
  "filter-data/easyprivacy.metadata.json",
]) {
  assert(firefoxContents.split("\n").includes(required), `Missing Firefox package entry ${required}.`);
}
assert.equal(
  firefoxContents.split("\n").includes("filter-data/easyprivacy.capabilities.json"),
  false,
  "The generation-time capability report must not ship in the Firefox package.",
);
const sourceContents = await capture("unzip", ["-Z1", sources], ROOT);
const sourceEntries = sourceContents.split("\n").filter(Boolean);
const sourcePackageJson = JSON.parse(
  await capture("unzip", ["-p", sources, "package.json"], ROOT),
);
assert.equal(sourcePackageJson.name, packageName);
assert.equal(sourcePackageJson.version, packageVersion);
assert.equal(sourcePackageJson.license, packageJson.license);
for (const required of [
  "LICENSE",
  "package-lock.json",
  "public/LICENSE",
  "public/THIRD-PARTY-NOTICES.txt",
  "public/filter-data/easyprivacy.engine",
  "public/filter-data/easyprivacy.metadata.json",
  "scripts/easyprivacy/generate.mjs",
  "scripts/easyprivacy/verify.mjs",
  "scripts/release/Dockerfile.amo",
  "scripts/release/run-amo-container.mjs",
  "scripts/release/verify-amo-reproducibility.mjs",
  "vendor/easyprivacy/easyprivacy.txt",
  "vendor/easyprivacy/easyprivacy.capabilities.json",
  "vendor/easyprivacy/source.json",
]) {
  assert(sourceEntries.includes(required), `Missing source package entry ${required}.`);
}
for (const forbidden of [
  "AGENTS.md",
  "GOAL.md",
  ".env",
  ".git/",
  ".output/",
  ".wxt/",
  "node_modules/",
  "docs/release-identity.md",
  "docs/release-path.md",
  "docs/roadmap.md",
]) {
  assert.equal(
    sourceEntries.some((entry) => entry === forbidden || entry.startsWith(forbidden)),
    false,
    `Source package unexpectedly contains ${forbidden}.`,
  );
}
const notices = await capture("unzip", ["-p", archive, "THIRD-PARTY-NOTICES.txt"], ROOT);
const packagedLicense = await capture("unzip", ["-p", archive, "LICENSE"], ROOT);
const sourceProjectLicense = await capture("unzip", ["-p", sources, "LICENSE"], ROOT);
const sourcePackagedLicense = await capture(
  "unzip",
  ["-p", sources, "public/LICENSE"],
  ROOT,
);
assert.equal(packagedLicense, projectLicense, "Packaged GPL text differs from root LICENSE.");
assert.equal(sourceProjectLicense, projectLicense, "Source GPL text differs from root LICENSE.");
assert.equal(
  sourcePackagedLicense,
  projectLicense,
  "Source public/LICENSE differs from root LICENSE.",
);

const productionPackages = Object.entries(packageLock.packages)
  .filter(([packagePath, details]) =>
    packagePath.startsWith("node_modules/") && details.dev !== true
  )
  .map(([packagePath, details]) => ({
    name: packagePath.slice(packagePath.lastIndexOf("node_modules/") + 13),
    ...details,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));
assert(productionPackages.length > 0, "No production dependencies found.");
for (const dependency of productionPackages) {
  assert.equal(typeof dependency.version, "string", `${dependency.name} version`);
  assert.equal(typeof dependency.license, "string", `${dependency.name} license`);
  assert.match(
    dependency.resolved,
    /^https:\/\/registry\.npmjs\.org\//,
    `${dependency.name} must resolve from the public npm registry`,
  );
  assert.match(
    dependency.integrity,
    /^sha512-/,
    `${dependency.name} must have a lockfile SHA-512 integrity value`,
  );
  const marker = `Package: ${dependency.name}@${dependency.version}`;
  const start = notices.indexOf(marker);
  assert.notEqual(start, -1, `Notice is missing ${marker}.`);
  const next = notices.indexOf("\nPackage: ", start + marker.length);
  const record = notices.slice(start, next === -1 ? undefined : next);
  for (const required of [
    `License: ${dependency.license}`,
    `Registry: ${dependency.resolved}`,
    `Integrity: ${dependency.integrity}`,
    "Source: https://",
  ]) {
    assert(
      record.includes(required),
      `${marker} record is missing ${required}.`,
    );
  }
}

const productionPackageByName = new Map(
  productionPackages.map((dependency) => [dependency.name, dependency]),
);
const extendedSelectors = productionPackageByName.get(
  "@ghostery/adblocker-extended-selectors",
);
const tldts = productionPackageByName.get("tldts");
const tldtsExperimental = productionPackageByName.get("tldts-experimental");
assert(extendedSelectors, "Missing production dependency @ghostery/adblocker-extended-selectors.");
assert(tldts, "Missing production dependency tldts.");
assert(tldtsExperimental, "Missing production dependency tldts-experimental.");

const parselHeading = "Parsel-derived CSS selector parser MIT license";
const publicSuffixHeading = "Public Suffix List";
const outfitHeading = "Outfit OFL-1.1 license";
const parselStart = notices.indexOf(parselHeading);
const publicSuffixStart = notices.indexOf(publicSuffixHeading);
const outfitStart = notices.indexOf(outfitHeading);
assert.notEqual(parselStart, -1, `Notice is missing ${parselHeading}.`);
assert.notEqual(publicSuffixStart, -1, `Notice is missing ${publicSuffixHeading}.`);
assert.notEqual(outfitStart, -1, `Notice is missing ${outfitHeading}.`);
assert(
  parselStart < publicSuffixStart && publicSuffixStart < outfitStart,
  "Parsel, Public Suffix List, and Outfit notices are not in the expected order.",
);

const parselNotice = notices.slice(parselStart, publicSuffixStart);
for (const required of [
  "Work: Parser code based on Parsel",
  "Upstream project: https://github.com/LeaVerou/parsel",
  `Embedded through: ${extendedSelectors.name}@${extendedSelectors.version}`,
]) {
  assert(parselNotice.includes(required), `Parsel notice is missing ${required}.`);
}
const parselLicenseMarker = "Copyright (c) 2020 Lea Verou";
const upstreamParselLicenseStart = extendedSelectorsParser.indexOf(
  parselLicenseMarker,
);
const upstreamParselLicenseEnd = extendedSelectorsParser.indexOf(
  " */",
  upstreamParselLicenseStart,
);
assert.notEqual(
  upstreamParselLicenseStart,
  -1,
  "Installed extended-selectors parser is missing the expected Parsel copyright.",
);
assert.notEqual(
  upstreamParselLicenseEnd,
  -1,
  "Installed extended-selectors parser has an unterminated Parsel license comment.",
);
const upstreamParselLicense = extendedSelectorsParser
  .slice(upstreamParselLicenseStart, upstreamParselLicenseEnd)
  .replace(/^\s*\*\s?/gm, "");
assert(
  normalizeLicenseText(parselNotice).includes(
    normalizeLicenseText(upstreamParselLicense),
  ),
  "Packaged Parsel MIT text differs from the installed extended-selectors license.",
);

const publicSuffixNotice = notices.slice(publicSuffixStart, outfitStart);
for (const required of [
  "Work: Public Suffix List",
  "License: Mozilla Public License version 2.0",
  "Upstream source: https://publicsuffix.org/list/public_suffix_list.dat",
  `Embedded through: ${tldts.name}@${tldts.version} and ${tldtsExperimental.name}@${tldtsExperimental.version}`,
  `https://github.com/remusao/tldts/tree/v${tldts.version}`,
  `https://github.com/remusao/tldts/tree/v${tldtsExperimental.version}`,
]) {
  assert(
    publicSuffixNotice.includes(required),
    `Public Suffix List notice is missing ${required}.`,
  );
}

const outfitLicenseMarker = "SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007";
const packagedOutfitLicenseStart = notices.indexOf(outfitLicenseMarker, outfitStart);
const upstreamOutfitLicenseStart = outfitLicense.indexOf(outfitLicenseMarker);
assert.notEqual(
  packagedOutfitLicenseStart,
  -1,
  "Outfit notice is missing the SIL Open Font License body.",
);
assert.notEqual(
  upstreamOutfitLicenseStart,
  -1,
  "Installed Outfit package is missing the expected SIL Open Font License body.",
);
assert.equal(
  normalizeLicenseText(notices.slice(packagedOutfitLicenseStart)),
  normalizeLicenseText(outfitLicense.slice(upstreamOutfitLicenseStart)),
  "Packaged Outfit OFL text differs from the installed package license.",
);

const metadata = JSON.parse(
  await readFile(path.join(output, "filter-data/easyprivacy.metadata.json"), "utf8"),
);
const sourceEasyPrivacy = JSON.parse(
  await readFile(path.join(ROOT, "vendor/easyprivacy/source.json"), "utf8"),
);
const capabilityReport = JSON.parse(
  await readFile(
    path.join(ROOT, "vendor/easyprivacy/easyprivacy.capabilities.json"),
    "utf8",
  ),
);
for (const required of [
  "https://www.mozilla.org/MPL/2.0/",
  "https://www.gnu.org/licenses/gpl-3.0.txt",
  "vendor/easyprivacy/easyprivacy.txt",
  `Upstream commit: ${sourceEasyPrivacy.upstreamCommit}`,
  `Source SHA-256: ${sourceEasyPrivacy.sourceSha256}`,
  `Capability report SHA-256: ${metadata.capabilityReportSha256}`,
  `Generated engine SHA-256: ${metadata.artifactSha256}`,
  `Packaged network rules: ${capabilityReport.packagedNetworkRules}`,
  `Excluded network rules: ${capabilityReport.excludedNetworkRules}`,
  `Excluded cosmetic rules: ${capabilityReport.cosmeticRulesExcluded}`,
]) {
  assert(notices.includes(required), `Notice is missing ${required}.`);
}

const outfitSourceDirectory = path.join(
  ROOT,
  "node_modules/@fontsource-variable/outfit/files",
);
const outfitOutputDirectory = path.join(output, "assets");
const sourceFontFiles = (await readdir(outfitSourceDirectory))
  .filter((filename) => /^outfit-latin(?:-ext)?-wght-normal\.woff2$/.test(filename))
  .sort();
const outputFontFiles = (await readdir(outfitOutputDirectory))
  .filter((filename) => /^outfit-latin(?:-ext)?-wght-normal-.+\.woff2$/.test(filename))
  .sort();
assert.equal(sourceFontFiles.length, 2);
assert.equal(outputFontFiles.length, 2);
assert.deepEqual(
  (await Promise.all(
    sourceFontFiles.map((filename) => sha256(path.join(outfitSourceDirectory, filename))),
  )).sort(),
  (await Promise.all(
    outputFontFiles.map((filename) => sha256(path.join(outfitOutputDirectory, filename))),
  )).sort(),
  "Packaged Outfit fonts differ from the official npm package inputs.",
);

const [archiveSha256, sourceArchiveSha256] = await Promise.all([
  sha256(archive),
  sha256(sources),
]);
const commit = (await capture("git", ["rev-parse", "HEAD"], ROOT)).trim();
const workingTreeStatus = (
  await capture("git", ["status", "--porcelain"], ROOT)
).trim();
process.stdout.write("\nEasyPrivacy package/source evidence\n");
process.stdout.write(
  `Revision: ${commit}${workingTreeStatus ? " with working-tree changes" : ""}\n`,
);
process.stdout.write(`Version: ${packageVersion}\n`);
process.stdout.write(
  `Extension ID: ${manifest.browser_specific_settings.gecko.id}\n`,
);
process.stdout.write(`EasyPrivacy artifact SHA-256: ${metadata.artifactSha256}\n`);
process.stdout.write(`Catalog-only counterfactual: ${baselineBytes} bytes\n`);
process.stdout.write(`EasyPrivacy package: ${fullBytes} bytes\n`);
process.stdout.write(`Complete compressed EasyPrivacy delta: ${deltaBytes} bytes\n`);
process.stdout.write(`Firefox archive: ${archiveName}\n`);
process.stdout.write(`Firefox archive size: ${archiveStats.size} bytes\n`);
process.stdout.write(`Firefox archive SHA-256: ${archiveSha256}\n`);
process.stdout.write(`Source archive: ${sourceArchiveName}\n`);
process.stdout.write(`Source archive size: ${sourceArchiveStats.size} bytes\n`);
process.stdout.write(`Source archive SHA-256: ${sourceArchiveSha256}\n`);
process.stdout.write(
  `Production dependency records: ${productionPackages.length} official npm packages with exact versions, licenses, registry URLs, and SHA-512 integrity values.\n`,
);
process.stdout.write(
  "Packaged GPL text matches the repository; Outfit font bytes match the official package; no local or private production dependency sources.\n",
);
process.stdout.write("Manifest permissions match the reviewed minimal set; no content scripts; package/source contents and private-build exclusions inspected.\n");

function assertReleaseIdentity(candidate, label) {
  assert.equal(
    candidate.name,
    "Tracker Blocker by Opt Out Rights",
    `${label} name`,
  );
  assert.equal(candidate.version, packageVersion, `${label} version`);
  assert.equal(
    candidate.developer?.name,
    "Opt Out Rights",
    `${label} developer`,
  );
  assert.equal(
    candidate.homepage_url,
    "https://github.com/OptOutRights/tracker-blocker",
    `${label} homepage`,
  );
  assert.equal(
    candidate.browser_specific_settings?.gecko?.id,
    "trackerblocker@optoutrights.org",
    `${label} Firefox extension ID`,
  );
  assert.equal("update_url" in candidate, false, `${label} update URL`);
  assert.equal(
    "update_url" in (candidate.browser_specific_settings?.gecko ?? {}),
    false,
    `${label} Firefox update URL`,
  );
}

function normalizeLicenseText(value) {
  return value
    .replace(/^-+$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(command, args, { cwd, env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}.`)),
      );
    });
  });
}

function capture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with ${code}: ${stderr}`)),
      );
    });
  });
}
