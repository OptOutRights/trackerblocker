import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "trackerblocker-degraded-"),
);
const temporarySource = path.join(temporaryRoot, "firefox-mv3");

try {
  await cp(path.join(ROOT, ".output/firefox-mv3"), temporarySource, {
    recursive: true,
  });
  const enginePath = path.join(
    temporarySource,
    "filter-data/easyprivacy.engine",
  );
  assert((await readFile(enginePath)).byteLength > 100_000);
  await writeFile(enginePath, new Uint8Array([0x54, 0x42, 0x2d, 0x42, 0x41, 0x44]));
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
          EASYPRIVACY_EXPECT_ENGINE_HEALTH: "degraded",
          EASYPRIVACY_EXTENSION_SOURCE: temporarySource,
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      signal
        ? reject(new Error(`Degraded Firefox test stopped by ${signal}.`))
        : resolve(code ?? 1);
    });
  });
}
