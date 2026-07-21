import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const background = await readFile(
  path.join(ROOT, "src/entrypoints/background.ts"),
  "utf8",
);
const runtimeFetches = [...background.matchAll(/fetch\(([^\n]+)\)/g)].map(
  ([, argument]) => argument.trim(),
);
assert.deepEqual(runtimeFetches, [
  'browser.runtime.getURL("/filter-data/easyprivacy.engine")',
  'browser.runtime.getURL("/filter-data/easyprivacy.metadata.json")',
]);

const update = await readFile(
  path.join(ROOT, "scripts/easyprivacy/update.mjs"),
  "utf8",
);
assert(update.includes("await fetch(SOURCE_URL"));
for (const file of ["generate.mjs", "verify.mjs"]) {
  const source = await readFile(path.join(ROOT, "scripts/easyprivacy", file), "utf8");
  assert.equal(/\bfetch\s*\(/.test(source), false, `${file} must remain offline.`);
}

const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const normalCommands = [
  "build",
  "build:firefox",
  "test",
  "typecheck",
  "lint:firefox",
  "zip:firefox",
  "verify:easyprivacy",
];
for (const name of normalCommands) {
  assert(packageJson.scripts[name]);
  assert.equal(
    packageJson.scripts[name].includes("update:easyprivacy"),
    false,
    `${name} must not invoke the network update path.`,
  );
}
assert.equal(
  packageJson.scripts["update:easyprivacy"],
  "node scripts/easyprivacy/update.mjs",
);

const options = await readFile(path.join(ROOT, "src/entrypoints/options/App.tsx"), "utf8");
const popup = await readFile(path.join(ROOT, "src/entrypoints/popup/App.tsx"), "utf8");
assert.equal(/https?:\/\//.test(options), false);
assert.equal(/https?:\/\//.test(popup), false);

process.stdout.write("EasyPrivacy offline/privacy architecture evidence\n");
process.stdout.write("- Runtime fetches are limited to two moz-extension packaged resources.\n");
process.stdout.write("- Normal build, test, verification, lint, and zip scripts do not call the update path.\n");
process.stdout.write("- The explicit update command is the only retained-list downloader.\n");
process.stdout.write("- Popup and options explanations contain no remote URL dependency.\n");
process.stdout.write("- Real-Firefox network and storage boundaries are asserted by test:easyprivacy:firefox.\n");
