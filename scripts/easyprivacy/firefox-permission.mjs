import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "trackerblocker-permission-"),
);
const temporarySource = path.join(temporaryRoot, "firefox-mv3");

try {
  await cp(path.join(ROOT, ".output/firefox-mv3"), temporarySource, {
    recursive: true,
  });
  const manifestPath = path.join(temporarySource, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  manifest.host_permissions = [];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.exitCode = await runIntegration();
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function runIntegration() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, "scripts/easyprivacy/firefox-integration.mjs")],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          EASYPRIVACY_EXPECT_HOST_PERMISSION: "false",
          EASYPRIVACY_EXTENSION_SOURCE: temporarySource,
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      signal
        ? reject(new Error(`Permission Firefox test stopped by ${signal}.`))
        : resolve(code ?? 1);
    });
  });
}
