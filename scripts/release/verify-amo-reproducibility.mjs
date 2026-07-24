import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const captureFile = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = path.join(ROOT, ".output");
const EXPECTED_ENVIRONMENT = {
  platform: "linux",
  architecture: "arm64",
  ubuntuPrettyName: "Ubuntu 24.04.4 LTS",
  node: "v24.14.0",
  npm: "11.9.0",
};

const options = parseArguments(process.argv.slice(2));
const packageJson = JSON.parse(
  await readFile(path.join(ROOT, "package.json"), "utf8"),
);
const extensionArchiveName =
  `${packageJson.name}-${packageJson.version}-firefox.zip`;
const sourceArchiveName =
  `${packageJson.name}-${packageJson.version}-sources.zip`;
const extensionArchive = path.join(OUTPUT, extensionArchiveName);
const sourceArchive = path.join(OUTPUT, sourceArchiveName);
const startedAt = new Date();

const repository = await inspectRepository();
if (!options.rehearsal) {
  assert(repository.available, "Final evidence requires a Git checkout.");
  assert.equal(
    repository.status,
    "",
    "Final evidence requires a clean working tree. Commit or remove every change first.",
  );
}

const environment = await inspectEnvironment();
const environmentDifferences = compareEnvironment(environment);
if (!options.rehearsal) {
  assert.deepEqual(
    environmentDifferences,
    [],
    `Build environment differs from Mozilla's default reviewer environment:\n${environmentDifferences.join("\n")}`,
  );
}

await run("npm", ["run", "zip:firefox"], ROOT);

const [extensionInspection, sourceInspection] = await Promise.all([
  inspectZip(extensionArchive),
  inspectZip(sourceArchive),
]);
validateExtensionArchive(extensionInspection);
validateSourceArchive(sourceInspection);

const { submittedFiles, rebuiltFiles, differences } =
  await rebuildAndCompare(extensionArchive, sourceArchive);

const evidenceDirectory = await createEvidenceDirectory(
  options.evidenceDirectory,
  repository.revision,
  options.rehearsal,
  startedAt,
);
const retainedExtensionArchive = path.join(
  evidenceDirectory,
  extensionArchiveName,
);
const retainedSourceArchive = path.join(evidenceDirectory, sourceArchiveName);
await Promise.all([
  copyFile(extensionArchive, retainedExtensionArchive),
  copyFile(sourceArchive, retainedSourceArchive),
]);

const evidence = {
  schemaVersion: 1,
  releaseReady:
    !options.rehearsal &&
    repository.available &&
    repository.status === "" &&
    environmentDifferences.length === 0,
  mode: options.rehearsal ? "rehearsal" : "final",
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  project: {
    name: packageJson.name,
    version: packageJson.version,
  },
  repository,
  environment: {
    expected: EXPECTED_ENVIRONMENT,
    actual: environment,
    differences: environmentDifferences,
  },
  install: {
    command: "npm ci --no-audit --no-fund",
    source: "submitted source archive",
  },
  build: {
    packagingCommand: "npm run zip:firefox",
    rebuildCommand: "npm run build:firefox",
    outputDirectory: ".output/firefox-mv3",
  },
  archives: {
    extension: await describeFile(retainedExtensionArchive),
    source: await describeFile(retainedSourceArchive),
  },
  archiveContents: {
    extension: extensionInspection.entries,
    source: sourceInspection.entries,
  },
  comparison: {
    byteIdenticalContents: true,
    submittedFileCount: submittedFiles.length,
    rebuiltFileCount: rebuiltFiles.length,
    differences,
    files: submittedFiles,
  },
};

await Promise.all([
  writeFile(
    path.join(evidenceDirectory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  ),
  writeFile(
    path.join(evidenceDirectory, "evidence.md"),
    renderEvidenceMarkdown(evidence),
  ),
]);

process.stdout.write("\nAMO reproducibility evidence\n");
process.stdout.write(`Mode: ${evidence.mode}\n`);
process.stdout.write(
  `Revision: ${repository.revision ?? "uncommitted working tree"}\n`,
);
process.stdout.write(
  `Environment: ${environment.osPrettyName}; ${environment.architecture}; Node ${environment.node}; npm ${environment.npm}\n`,
);
if (environmentDifferences.length > 0) {
  process.stdout.write(
    `Environment differences: ${environmentDifferences.join("; ")}\n`,
  );
}
process.stdout.write(
  `Comparison: ${submittedFiles.length} files rebuilt byte-for-byte\n`,
);
process.stdout.write(`Evidence: ${evidenceDirectory}\n`);
if (options.rehearsal) {
  process.stdout.write(
    "Result: rehearsal passed; rerun without --rehearsal from the clean release commit for final evidence.\n",
  );
} else {
  process.stdout.write("Result: final reproducibility verification passed.\n");
}

function parseArguments(argumentsList) {
  let rehearsal = false;
  let evidenceDirectory = path.join(OUTPUT, "amo-evidence");

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--rehearsal") {
      rehearsal = true;
      continue;
    }
    if (argument === "--evidence-dir") {
      const value = argumentsList[index + 1];
      assert(value, "--evidence-dir requires a path.");
      evidenceDirectory = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { evidenceDirectory, rehearsal };
}

async function inspectRepository() {
  try {
    const [revision, status] = await Promise.all([
      capture("git", ["rev-parse", "HEAD"], ROOT),
      capture(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        ROOT,
      ),
    ]);
    return {
      available: true,
      revision: revision.trim(),
      status: status.trim(),
    };
  } catch {
    return {
      available: false,
      revision: null,
      status: null,
    };
  }
}

async function inspectEnvironment() {
  const osRelease = await readOsRelease();
  const npmVersion = (await capture("npm", ["--version"], ROOT)).trim();
  const filesystem = await statfs(ROOT);

  return {
    platform: process.platform,
    architecture: process.arch,
    osPrettyName: osRelease.PRETTY_NAME ?? os.release(),
    osVersionId: osRelease.VERSION_ID ?? null,
    kernel: `${os.type()} ${os.release()}`,
    node: process.version,
    npm: npmVersion,
    cpuCount: os.availableParallelism(),
    totalMemoryBytes: os.totalmem(),
    freeDiskBytes: filesystem.bavail * filesystem.bsize,
  };
}

async function readOsRelease() {
  try {
    const text = await readFile("/etc/os-release", "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const key = line.slice(0, separator);
          const value = line
            .slice(separator + 1)
            .replace(/^"(.*)"$/, "$1");
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

function compareEnvironment(actual) {
  const differences = [];
  for (const [key, expected] of [
    ["platform", EXPECTED_ENVIRONMENT.platform],
    ["architecture", EXPECTED_ENVIRONMENT.architecture],
    ["osPrettyName", EXPECTED_ENVIRONMENT.ubuntuPrettyName],
    ["node", EXPECTED_ENVIRONMENT.node],
    ["npm", EXPECTED_ENVIRONMENT.npm],
  ]) {
    if (actual[key] !== expected) {
      differences.push(`${key}: expected ${expected}, received ${actual[key]}`);
    }
  }
  return differences;
}

async function inspectZip(archivePath) {
  const listing = await capture("unzip", ["-Z1", archivePath], ROOT);
  const entries = listing
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ""))
    .filter(Boolean)
    .sort();
  const uniqueEntries = new Set(entries);
  assert.equal(
    uniqueEntries.size,
    entries.length,
    `${path.basename(archivePath)} contains duplicate paths.`,
  );
  for (const entry of entries) {
    assert(!path.posix.isAbsolute(entry), `Archive has absolute path ${entry}.`);
    assert(!entry.includes("\\"), `Archive has non-portable path ${entry}.`);
    assert(
      !entry.split("/").includes(".."),
      `Archive has path traversal entry ${entry}.`,
    );
  }
  return {
    path: archivePath,
    entries,
  };
}

function validateExtensionArchive(inspection) {
  for (const required of [
    "LICENSE",
    "THIRD-PARTY-NOTICES.txt",
    "background.js",
    "manifest.json",
    "options.html",
    "popup.html",
  ]) {
    assert(
      inspection.entries.includes(required),
      `Extension archive is missing ${required}.`,
    );
  }
}

function validateSourceArchive(inspection) {
  for (const required of [
    "LICENSE",
    "README.md",
    "package-lock.json",
    "package.json",
    "public/LICENSE",
    "public/THIRD-PARTY-NOTICES.txt",
    "scripts/release/Dockerfile.amo",
    "scripts/release/run-amo-container.mjs",
    "scripts/release/verify-amo-reproducibility.mjs",
    "vendor/easyprivacy/easyprivacy.txt",
    "wxt.config.ts",
  ]) {
    assert(
      inspection.entries.includes(required),
      `Source archive is missing ${required}.`,
    );
  }

  const forbidden = inspection.entries.filter((entry) => {
    const segments = entry.split("/");
    const basename = segments.at(-1);
    return (
      segments.some((segment) =>
        ["node_modules", ".git", ".output", ".wxt"].includes(segment),
      ) ||
      basename === ".env" ||
      basename?.startsWith(".env.") ||
      ["AGENTS.md", "docs/release-identity.md", "docs/release-path.md",
        "docs/roadmap.md"].includes(entry) ||
      /\.(?:key|p12|pfx|pem)$/i.test(basename ?? "") ||
      /^(?:credentials|id_rsa|id_ed25519)$/i.test(basename ?? "")
    );
  });
  assert.deepEqual(
    forbidden,
    [],
    `Source archive contains forbidden files:\n${forbidden.join("\n")}`,
  );
}

async function validateReviewerReadme(sourceDirectory) {
  const readme = await readFile(path.join(sourceDirectory, "README.md"), "utf8");
  for (const required of [
    "## AMO reviewer build",
    "Ubuntu 24.04.4 LTS on ARM64",
    "Node 24.14.0 and npm 11.9.0",
    "npm ci --no-audit --no-fund",
    "npm run build:firefox",
    ".output/firefox-mv3",
    "https://extensionworkshop.com/documentation/publish/source-code-submission/",
  ]) {
    assert(
      readme.includes(required),
      `Source README is missing reviewer instruction: ${required}`,
    );
  }
}

async function rebuildAndCompare(extensionPath, sourcePath) {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "trackerblocker-amo-rebuild-"),
  );
  try {
    const submittedDirectory = path.join(
      temporaryDirectory,
      "submitted-extension",
    );
    const sourceDirectory = path.join(temporaryDirectory, "submitted-source");
    await Promise.all([
      mkdir(submittedDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
    ]);
    await run("unzip", ["-q", extensionPath, "-d", submittedDirectory], ROOT);
    await run("unzip", ["-q", sourcePath, "-d", sourceDirectory], ROOT);
    await validateReviewerReadme(sourceDirectory);

    await run("npm", ["ci", "--no-audit", "--no-fund"], sourceDirectory);
    await run("npm", ["run", "build:firefox"], sourceDirectory);

    const rebuiltDirectory = path.join(
      sourceDirectory,
      ".output",
      "firefox-mv3",
    );
    const [submittedFiles, rebuiltFiles] = await Promise.all([
      createFileManifest(submittedDirectory),
      createFileManifest(rebuiltDirectory),
    ]);
    const differences = compareFileManifests(submittedFiles, rebuiltFiles);
    assert.deepEqual(
      differences,
      [],
      `Rebuilt extension differs from the submitted extension:\n${differences.join("\n")}`,
    );
    return { submittedFiles, rebuiltFiles, differences };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createFileManifest(rootDirectory) {
  const files = [];
  await walk(rootDirectory, "");
  return files.sort((left, right) => left.path.localeCompare(right.path));

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(
        relativeDirectory,
        entry.name,
      );
      const metadata = await lstat(absolutePath);
      assert(
        !metadata.isSymbolicLink(),
        `Build output contains symbolic link ${relativePath}.`,
      );
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({
          path: relativePath,
          size: metadata.size,
          sha256: await sha256(absolutePath),
        });
      } else {
        throw new Error(`Unsupported build output entry ${relativePath}.`);
      }
    }
  }
}

function compareFileManifests(submitted, rebuilt) {
  const submittedByPath = new Map(
    submitted.map((entry) => [entry.path, entry]),
  );
  const rebuiltByPath = new Map(rebuilt.map((entry) => [entry.path, entry]));
  const paths = [...new Set([
    ...submittedByPath.keys(),
    ...rebuiltByPath.keys(),
  ])].sort();
  const differences = [];

  for (const filePath of paths) {
    const submittedEntry = submittedByPath.get(filePath);
    const rebuiltEntry = rebuiltByPath.get(filePath);
    if (!submittedEntry) {
      differences.push(`only rebuilt: ${filePath}`);
    } else if (!rebuiltEntry) {
      differences.push(`only submitted: ${filePath}`);
    } else if (
      submittedEntry.size !== rebuiltEntry.size ||
      submittedEntry.sha256 !== rebuiltEntry.sha256
    ) {
      differences.push(`content differs: ${filePath}`);
    }
  }
  return differences;
}

async function createEvidenceDirectory(
  evidenceRoot,
  revision,
  rehearsal,
  timestamp,
) {
  const revisionLabel = revision?.slice(0, 12) ?? "working-tree";
  const timestampLabel = timestamp
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const runName = [
    packageJson.name,
    packageJson.version,
    revisionLabel,
    rehearsal ? "rehearsal" : "final",
    timestampLabel,
  ].join("-");
  const directory = path.join(evidenceRoot, runName);
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(directory, { recursive: false });
  return directory;
}

async function describeFile(filePath) {
  const metadata = await stat(filePath);
  return {
    name: path.basename(filePath),
    size: metadata.size,
    sha256: await sha256(filePath),
  };
}

function renderEvidenceMarkdown(evidence) {
  const extension = evidence.archives.extension;
  const source = evidence.archives.source;
  const differences = evidence.environment.differences;
  return `# AMO reproducibility evidence

- Mode: ${evidence.mode}
- Release ready: ${evidence.releaseReady ? "yes" : "no"}
- Revision: ${evidence.repository.revision ?? "uncommitted working tree"}
- Version: ${evidence.project.version}
- Started: ${evidence.startedAt}
- Completed: ${evidence.completedAt}
- Environment: ${evidence.environment.actual.osPrettyName}; ${evidence.environment.actual.architecture}; Node ${evidence.environment.actual.node}; npm ${evidence.environment.actual.npm}
- Resources: ${evidence.environment.actual.cpuCount} CPUs; ${formatBytes(evidence.environment.actual.totalMemoryBytes)} RAM; ${formatBytes(evidence.environment.actual.freeDiskBytes)} free disk
- Environment differences: ${differences.length === 0 ? "none" : differences.join("; ")}
- Install: \`${evidence.install.command}\`
- Package: \`${evidence.build.packagingCommand}\`
- Rebuild: \`${evidence.build.rebuildCommand}\`

| Archive | Size | SHA-256 |
| --- | ---: | --- |
| \`${extension.name}\` | ${extension.size} bytes | \`${extension.sha256}\` |
| \`${source.name}\` | ${source.size} bytes | \`${source.sha256}\` |

The submitted source archive was extracted into a fresh directory, its locked
dependencies were installed, and its Firefox build was compared with the
submitted extension. All ${evidence.comparison.submittedFileCount} files were
byte-identical; there were no missing, additional, or changed files.
`;
}

function formatBytes(value) {
  return `${(value / (1024 ** 3)).toFixed(2)} GiB`;
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function capture(command, argumentsList, cwd) {
  const { stdout } = await captureFile(command, argumentsList, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function run(command, argumentsList, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd,
      env: process.env,
      stdio: "inherit",
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
  });
}
