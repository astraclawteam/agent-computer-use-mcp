import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLIC_PACKAGES = new Set([
  "agent-computer-use-mcp",
  "@xiaozhiclaw/agent-computer-use-win32-x64",
]);
const REGISTRY = "https://registry.npmjs.org/";

export async function runNpmPackageRelease(args, operations = createNpmReleaseOperations()) {
  const options = parseArgs(args);
  const inspected = await operations.inspect(options.packagePath);
  if (!PUBLIC_PACKAGES.has(inspected.name)) {
    throw new Error(`release.package_unexpected: ${inspected.name}`);
  }
  if (typeof inspected.version !== "string" || inspected.version.length === 0) {
    throw new Error("release.version_missing");
  }
  const sourceVersion = await operations.sourceVersion();
  if (inspected.version !== sourceVersion) {
    throw new Error(`release.source_version_mismatch: expected ${sourceVersion}, received ${inspected.version}`);
  }
  const canonicalFilename = canonicalTarballFilename(inspected.name, sourceVersion);
  if (basename(options.packagePath) !== canonicalFilename) {
    throw new Error(`release.package_filename_mismatch: expected ${canonicalFilename}`);
  }
  const expectedSha512 = await operations.sourceArtifactSha512(inspected.name, sourceVersion);
  const actualSha512 = await operations.sha512(options.packagePath);
  if (actualSha512 !== expectedSha512) {
    throw new Error("release.artifact_mismatch: tarball does not match the current clean source");
  }

  const registryVersion = await operations.registryVersion(inspected.name, inspected.version);
  const base = {
    packageName: inspected.name,
    packageVersion: inspected.version,
    packagePath: options.packagePath,
    publishRequested: options.publish,
  };
  if (registryVersion === inspected.version) {
    return { ...base, status: "already-published" };
  }
  if (registryVersion !== null) {
    throw new Error(`release.registry_identity_invalid: ${registryVersion}`);
  }
  if (!options.publish) return { ...base, status: "ready" };

  await operations.publish(options.packagePath);
  return { ...base, status: "published" };
}

function parseArgs(args) {
  let packagePath;
  let publish = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--package") {
      if (packagePath !== undefined) throw new Error("release.package_repeated");
      packagePath = args[++index];
      if (!packagePath) throw new Error("release.package_required");
    } else if (value === "--publish") {
      publish = true;
    } else {
      throw new Error(`release.argument_unknown: ${value}`);
    }
  }
  if (!packagePath) throw new Error("release.package_required");
  if (!packagePath.endsWith(".tgz")) throw new Error("release.package_tarball_required");
  return { packagePath: resolve(packagePath), publish };
}

export function createNpmReleaseOperations(run = runNpm) {
  return {
    async sourceVersion() {
      return JSON.parse(await readFile("package.json", "utf8")).version;
    },
    sourceArtifactSha512: buildSourceArtifactSha512,
    sha512: fileSha512,
    async inspect(packagePath) {
      const result = await run([
        "pack",
        packagePath,
        "--dry-run",
        "--json",
      ]);
      if (result.exitCode !== 0) throw commandError("release.package_preflight_failed", result);
      const [report] = JSON.parse(result.stdout);
      return { name: report.name, version: report.version };
    },
    async registryVersion(name, version) {
      const result = await run([
        "view",
        `${name}@${version}`,
        "version",
        "--json",
        "--registry",
        REGISTRY,
      ]);
      if (result.exitCode === 0) return JSON.parse(result.stdout);
      if (/\bE404\b|404 Not Found/iu.test(result.stderr)) return null;
      throw commandError("release.registry_preflight_failed", result);
    },
    async publish(packagePath) {
      const result = await run([
        "publish",
        packagePath,
        "--access",
        "public",
        "--ignore-scripts",
        "--registry",
        REGISTRY,
      ]);
      if (result.exitCode !== 0) throw commandError("release.publish_failed", result);
    },
  };
}

async function buildSourceArtifactSha512(name, version) {
  await assertCleanSource();
  const root = resolve("artifacts", `npm-release-verification-${randomUUID()}`);
  try {
    const packageRoot = join(root, "package");
    const releaseRoot = join(root, "release");
    await mkdir(releaseRoot, { recursive: true });
    if (name === "agent-computer-use-mcp") {
      const { packProtectedNpmPackage } = await import("./pack-protected-npm-package.mjs");
      const report = await packProtectedNpmPackage({ packageRoot, releaseRoot });
      assertBuiltIdentity(report.packageName, report.packageVersion, name, version);
      return fileSha512(report.tarballPath);
    }

    const head = await runGit(["rev-parse", "HEAD"]);
    if (head.exitCode !== 0) throw commandError("release.git_head_failed", head);
    const sourceCommit = head.stdout.trim();
    const { buildWindowsPlatformPackage } = await import("../src/windows-platform-package.mjs");
    await buildWindowsPlatformPackage({
      outputRoot: packageRoot,
      version,
      sourceCommit,
      allowNetwork: true,
    });
    const packed = await runNpm(["pack", packageRoot, "--json", "--pack-destination", releaseRoot]);
    if (packed.exitCode !== 0) throw commandError("release.npm_pack_failed", packed);
    const [report] = JSON.parse(packed.stdout);
    assertBuiltIdentity(report.name, report.version, name, version);
    return fileSha512(join(releaseRoot, report.filename));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertCleanSource() {
  const result = await runGit(["status", "--porcelain", "--untracked-files=normal"]);
  if (result.exitCode !== 0) throw commandError("release.git_status_failed", result);
  if (result.stdout.trim() !== "") throw new Error("release.source_dirty");
}

function canonicalTarballFilename(name, version) {
  return name === "agent-computer-use-mcp"
    ? `agent-computer-use-mcp-${version}.tgz`
    : `agent-computer-use-win32-x64-${version}.tgz`;
}

function assertBuiltIdentity(name, version, expectedName, expectedVersion) {
  if (name !== expectedName || version !== expectedVersion) {
    throw new Error(`release.source_artifact_identity_mismatch: ${name}@${version}`);
  }
}

async function fileSha512(path) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function runGit(args) {
  return runCommand("git", args);
}

function runNpm(args) {
  const npm = resolveNpmCli();
  return runCommand(npm.command, [...npm.prefixArgs, ...args]);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
  });
}

function resolveNpmCli() {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefixArgs: [process.env.npm_execpath] };
  }
  const adjacentCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(adjacentCli)) {
    return { command: process.execPath, prefixArgs: [adjacentCli] };
  }
  return {
    command: process.platform === "win32" ? "cmd.exe" : "npm",
    prefixArgs: process.platform === "win32" ? ["/d", "/s", "/c", "npm"] : [],
  };
}

function commandError(code, result) {
  return new Error(`${code}: ${(result.stderr || result.stdout).trim()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runNpmPackageRelease(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
