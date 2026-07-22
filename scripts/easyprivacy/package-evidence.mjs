import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(ROOT, ".output/firefox-mv3");
const archive = path.join(ROOT, ".output/trackerblocker-0.0.0-firefox.zip");
const sources = path.join(ROOT, ".output/trackerblocker-0.0.0-sources.zip");
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
assert(
  baselineBytes < maxCatalogOnlyBytes,
  `The ${baselineBytes}-byte catalog-only counterfactual exceeds the ${maxCatalogOnlyBytes}-byte sanity bound and may still contain EasyPrivacy code.`,
);
assert(deltaBytes > 0 && deltaBytes < 1_500_000);

const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
assert.deepEqual(manifest.permissions, [
  "activeTab",
  "storage",
  "webRequest",
  "webRequestBlocking",
]);
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
assert.equal("content_scripts" in manifest, false);

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
const commit = (await capture("git", ["rev-parse", "HEAD"], ROOT)).trim();
const trackedStatus = (
  await capture("git", ["status", "--porcelain", "--untracked-files=no"], ROOT)
).trim();
process.stdout.write("\nEasyPrivacy package/source evidence\n");
process.stdout.write(
  `Revision: ${commit}${trackedStatus ? " with tracked working-tree changes" : ""}\n`,
);
process.stdout.write(`Artifact SHA-256: ${metadata.artifactSha256}\n`);
process.stdout.write(`Catalog-only counterfactual: ${baselineBytes} bytes\n`);
process.stdout.write(`EasyPrivacy package: ${fullBytes} bytes\n`);
process.stdout.write(`Complete compressed EasyPrivacy delta: ${deltaBytes} bytes\n`);
process.stdout.write(`Firefox zip: ${(await stat(archive)).size} bytes\n`);
process.stdout.write(`Source zip: ${(await stat(sources)).size} bytes\n`);
process.stdout.write("Manifest permissions unchanged; no content scripts; package/source contents and private-build exclusions inspected.\n");

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
