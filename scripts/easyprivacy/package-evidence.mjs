import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(ROOT, ".output/firefox-mv3");
const packageJson = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8"),
);
assert.equal(packageJson.name, "trackerblocker");
assert.equal(typeof packageJson.version, "string");
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
for (const required of [
  "LICENSE",
  "package-lock.json",
  "public/THIRD-PARTY-NOTICES.txt",
  "public/filter-data/easyprivacy.engine",
  "public/filter-data/easyprivacy.metadata.json",
  "scripts/easyprivacy/generate.mjs",
  "scripts/easyprivacy/verify.mjs",
  "vendor/easyprivacy/easyprivacy.txt",
  "vendor/easyprivacy/easyprivacy.capabilities.json",
  "vendor/easyprivacy/source.json",
]) {
  assert(sourceEntries.includes(required), `Missing source package entry ${required}.`);
}
for (const forbidden of [
  "GOAL.md",
  ".env",
  ".git/",
  ".output/",
  ".wxt/",
  "node_modules/",
]) {
  assert.equal(
    sourceEntries.some((entry) => entry === forbidden || entry.startsWith(forbidden)),
    false,
    `Source package unexpectedly contains ${forbidden}.`,
  );
}
const notices = await capture("unzip", ["-p", archive, "THIRD-PARTY-NOTICES.txt"], ROOT);
for (const required of [
  "v2.18.1",
  "v1.3.1",
  "https://www.mozilla.org/MPL/2.0/",
  "https://www.gnu.org/licenses/gpl-3.0.txt",
  "vendor/easyprivacy/easyprivacy.txt",
]) {
  assert(notices.includes(required), `Notice is missing ${required}.`);
}

const metadata = JSON.parse(
  await readFile(path.join(output, "filter-data/easyprivacy.metadata.json"), "utf8"),
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
