import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const captureFile = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE = "trackerblocker-amo-reviewer:node-24.14.0-npm-11.9.0";
const EVIDENCE_DIRECTORY = path.join(ROOT, ".output", "amo-evidence");
const options = parseArguments(process.argv.slice(2));

const repositoryStatus = (
  await capture(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    ROOT,
  )
).trim();
if (!options.rehearsal) {
  assert.equal(
    repositoryStatus,
    "",
    "Final container verification requires a clean working tree. Use --rehearsal while developing the release workflow.",
  );
}

const dockerArchitecture = (
  await capture("docker", ["info", "--format", "{{.Architecture}}"], ROOT)
).trim();
assert(
  ["arm64", "aarch64"].includes(dockerArchitecture),
  `Docker must use a native ARM64 Linux engine; received ${dockerArchitecture}.`,
);

await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "trackerblocker-amo-container-"),
);

try {
  const input = options.rehearsal
    ? await createRehearsalInput(temporaryDirectory)
    : await createFinalInput(temporaryDirectory);

  await run(
    "docker",
    [
      "build",
      "--platform",
      "linux/arm64",
      "--file",
      "scripts/release/Dockerfile.amo",
      "--tag",
      IMAGE,
      "scripts/release",
    ],
    ROOT,
  );

  const containerCommand = options.rehearsal
    ? [
        "mkdir -p /work/trackerblocker",
        "tar -xf /input/worktree.tar -C /work/trackerblocker",
        "cd /work/trackerblocker",
        "npm ci --no-audit --no-fund",
        "npm run verify:amo -- --rehearsal --evidence-dir /evidence",
      ].join(" && ")
    : [
        "git clone --quiet --no-local /input/repository /work/trackerblocker",
        "cd /work/trackerblocker",
        `test "$(git rev-parse HEAD)" = "${input.revision}"`,
        "npm ci --no-audit --no-fund",
        "npm run verify:amo -- --evidence-dir /evidence",
      ].join(" && ");

  await run(
    "docker",
    [
      "run",
      "--rm",
      "--platform",
      "linux/arm64",
      "--cpus",
      "6",
      "--volume",
      `${input.path}:${input.containerPath}:ro`,
      "--volume",
      `${EVIDENCE_DIRECTORY}:/evidence`,
      IMAGE,
      "bash",
      "-lc",
      containerCommand,
    ],
    ROOT,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function createRehearsalInput(temporaryDirectory) {
  const archivePath = path.join(temporaryDirectory, "worktree.tar");
  const files = await captureBuffer(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    ROOT,
  );
  assert(files.length > 0, "No project files were found for the rehearsal.");
  await runWithInput(
    "tar",
    ["--no-xattrs", "--null", "-T", "-", "-cf", archivePath],
    ROOT,
    files,
  );
  return {
    containerPath: "/input/worktree.tar",
    path: archivePath,
    revision: null,
  };
}

async function createFinalInput(temporaryDirectory) {
  const clonePath = path.join(temporaryDirectory, "repository");
  await run(
    "git",
    ["clone", "--quiet", "--no-local", ROOT, clonePath],
    ROOT,
  );
  const revision = (
    await capture("git", ["rev-parse", "HEAD"], clonePath)
  ).trim();
  return {
    containerPath: "/input/repository",
    path: clonePath,
    revision,
  };
}

function parseArguments(argumentsList) {
  if (argumentsList.length === 0) {
    return { rehearsal: false };
  }
  if (
    argumentsList.length === 1 &&
    argumentsList[0] === "--rehearsal"
  ) {
    return { rehearsal: true };
  }
  throw new Error(
    "Usage: node scripts/release/run-amo-container.mjs [--rehearsal]",
  );
}

async function capture(command, argumentsList, cwd) {
  const { stdout } = await captureFile(command, argumentsList, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function captureBuffer(command, argumentsList, cwd) {
  const { stdout } = await captureFile(command, argumentsList, {
    cwd,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function run(command, argumentsList, cwd) {
  await runChild(command, argumentsList, cwd);
}

async function runWithInput(command, argumentsList, cwd, input) {
  await runChild(command, argumentsList, cwd, input);
}

async function runChild(command, argumentsList, cwd, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd,
      env: process.env,
      stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `${command} ${argumentsList.join(" ")} failed with ${
              signal ? `signal ${signal}` : `exit code ${code}`
            }.`,
          ),
        );
      }
    });
    if (input) {
      child.stdin.end(input);
    }
  });
}
