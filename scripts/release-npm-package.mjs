import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { assertNoCutoverReleaseDefinition, readRetirementRecords, validateRetirementRecords } from "./block-source-publish.mjs";

const execFileAsync = promisify(execFile);

const PUBLIC_PACKAGES = new Set([
  "agent-computer-use-mcp",
  "@xiaozhiclaw/agent-computer-use-win32-x64",
]);
const CORE_PACKAGE = "agent-computer-use-mcp";
const PLATFORM_PACKAGE = "@xiaozhiclaw/agent-computer-use-win32-x64";
const REGISTRY = "https://registry.npmjs.org/";
const POSTPUBLISH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 90_000, 120_000];

export function assertReleaseCutover(records, releaseDefinitionPresent = true) {
  validateRetirementRecords(records);
  const cutOver = records.some((record) => record?.cutover === true && PUBLIC_PACKAGES.has(record.package));
  if (cutOver && releaseDefinitionPresent) throw new Error("release.cut_over_definition_present");
}

export async function verifyReleaseSourceIdentity(version, run = runGit) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("release.source_version_invalid");
  }
  const tag = `v${version}`;
  await requireGit(run, ["fetch", "--quiet", "origin", "main", "--tags"], "release.git_fetch_failed");
  const status = await requireGit(
    run,
    ["status", "--porcelain", "--untracked-files=normal"],
    "release.git_status_failed",
  );
  if (status.stdout.trim() !== "") throw new Error("release.source_dirty");
  const head = (await requireGit(run, ["rev-parse", "HEAD"], "release.git_head_failed")).stdout.trim();
  const tagged = (await requireGit(run, ["rev-list", "-n", "1", tag], "release.git_tag_failed")).stdout.trim();
  const trackedMain = (await requireGit(
    run,
    ["rev-parse", "refs/remotes/origin/main"],
    "release.git_origin_main_failed",
  )).stdout.trim();
  const remote = await requireGit(
    run,
    ["ls-remote", "origin", "refs/heads/main", `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    "release.git_remote_identity_failed",
  );
  const remoteRefs = new Map(remote.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [commit, ref] = line.split(/\s+/u);
    return [ref, commit];
  }));
  const remoteMain = remoteRefs.get("refs/heads/main");
  const remoteTag = remoteRefs.get(`refs/tags/${tag}^{}`) ?? remoteRefs.get(`refs/tags/${tag}`);
  if (
    !/^[0-9a-f]{40}$/u.test(head)
    || head !== tagged
    || head !== trackedMain
    || head !== remoteMain
    || head !== remoteTag
  ) {
    throw new Error("release.source_commit_not_authoritative");
  }
  const packageSource = await requireGit(
    run,
    ["show", `${head}:package.json`],
    "release.git_package_version_failed",
  );
  if (JSON.parse(packageSource.stdout).version !== version) {
    throw new Error("release.source_version_mismatch");
  }
  return { version, tag, commit: head };
}

async function requireGit(run, args, code) {
  const result = await run(args);
  if (result.exitCode !== 0) throw commandError(code, result);
  return result;
}

export async function runNpmPackageRelease(args, operations = createNpmReleaseOperations(), { root = process.cwd() } = {}) {
  const retirementRecords = readRetirementRecords(root);
  assertNoCutoverReleaseDefinition(retirementRecords, root);
  const options = parseArgs(args);
  const inspected = await operations.inspect(options.packagePath);
  if (!PUBLIC_PACKAGES.has(inspected.name)) {
    throw new Error(`release.package_unexpected: ${inspected.name}`);
  }
  if (typeof inspected.version !== "string" || inspected.version.length === 0) {
    throw new Error("release.version_missing");
  }
  const sourceIdentity = await operations.sourceIdentity(inspected.version);
  const sourceVersion = await operations.sourceVersion(sourceIdentity);
  if (inspected.version !== sourceVersion) {
    throw new Error(`release.source_version_mismatch: expected ${sourceVersion}, received ${inspected.version}`);
  }
  const canonicalFilename = canonicalTarballFilename(inspected.name, sourceVersion);
  if (basename(options.packagePath) !== canonicalFilename) {
    throw new Error(`release.package_filename_mismatch: expected ${canonicalFilename}`);
  }
  const expectedSha512 = await operations.sourceArtifactSha512(inspected.name, sourceVersion, sourceIdentity);
  const expectedPlatformSha512 = inspected.name === CORE_PACKAGE
    ? await operations.sourceArtifactSha512(PLATFORM_PACKAGE, sourceVersion, sourceIdentity)
    : null;
  await operations.verifySourceIdentity(sourceIdentity);
  const snapshot = await operations.snapshot(options.packagePath, canonicalFilename, expectedSha512);
  try {
    if (expectedPlatformSha512 !== null) {
      const platform = await operations.registryPackage(PLATFORM_PACKAGE, inspected.version);
      if (platform === null) throw new Error("release.platform_registry_missing");
      assertRegistryPackage(platform, inspected.version, expectedPlatformSha512, "release.platform_registry");
    }
    const registryPackage = await operations.registryPackage(inspected.name, inspected.version);
    const base = {
      packageName: inspected.name,
      packageVersion: inspected.version,
      packagePath: options.packagePath,
      publishRequested: options.publish,
    };
    if (registryPackage !== null) {
      assertRegistryPackage(registryPackage, inspected.version, expectedSha512, "release.registry");
      return { ...base, status: "already-published" };
    }
    if (!options.publish) return { ...base, status: "ready" };

    if (await operations.sha512(snapshot.path) !== expectedSha512) {
      throw new Error("release.snapshot_mismatch");
    }
    await operations.publish(snapshot.path);
    await verifyPostpublishRegistry(
      operations,
      inspected.name,
      inspected.version,
      expectedSha512,
    );
    return { ...base, status: "published" };
  } finally {
    await snapshot.cleanup();
  }
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
    sourceIdentity: verifyReleaseSourceIdentity,
    async sourceVersion(identity) { return identity.version; },
    async verifySourceIdentity(expected) {
      const actual = await verifyReleaseSourceIdentity(expected.version);
      if (actual.commit !== expected.commit) throw new Error("release.source_changed_after_build");
    },
    sourceArtifactSha512: buildSourceArtifactSha512,
    sha512: fileSha512,
    snapshot: createVerifiedSnapshot,
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
    async registryPackage(name, version) {
      const result = await run([
        "view",
        `${name}@${version}`,
        "version",
        "dist.integrity",
        "--json",
        "--registry",
        REGISTRY,
      ]);
      if (result.exitCode === 0) {
        const report = JSON.parse(result.stdout);
        return {
          version: report.version,
          integrity: report["dist.integrity"] ?? report.dist?.integrity,
        };
      }
      if (/\b(?:E404|ETARGET)\b|404 Not Found|No matching version found/iu.test(result.stderr)) return null;
      throw commandError("release.registry_preflight_failed", result);
    },
    waitForRegistry: (delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
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

function assertRegistryPackage(actual, expectedVersion, expectedSha512, code) {
  if (actual.version !== expectedVersion) {
    throw new Error(`${code}_identity_invalid: ${actual.version}`);
  }
  if (actual.integrity !== sha512Integrity(expectedSha512)) {
    throw new Error(`${code}_integrity_mismatch`);
  }
}

async function verifyPostpublishRegistry(operations, name, version, expectedSha512) {
  let lastFailure;
  for (let attempt = 0; attempt <= POSTPUBLISH_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await operations.waitForRegistry?.(POSTPUBLISH_RETRY_DELAYS_MS[attempt - 1]);
    }
    const actual = await operations.registryPackage(name, version);
    if (actual !== null) {
      assertRegistryPackage(actual, version, expectedSha512, "release.postpublish_registry");
      return;
    }
    lastFailure = new Error("release.postpublish_registry_missing");
  }
  throw new Error(
    "release.postpublish_verification_failed: publication may have succeeded; verify the exact registry version before republishing",
    { cause: lastFailure },
  );
}

function sha512Integrity(sha512) {
  if (!/^[0-9a-f]{128}$/u.test(sha512)) throw new Error("release.sha512_invalid");
  return `sha512-${Buffer.from(sha512, "hex").toString("base64")}`;
}

export async function createVerifiedSnapshot(sourcePath, canonicalFilename, expectedSha512, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-npm-release-"));
  const snapshotPath = join(root, canonicalFilename);
  const hash = createHash("sha512");
  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    if ((options.platform ?? process.platform) === "win32") {
      await (options.hardenDirectory ?? hardenWindowsSnapshotDirectory)(root);
    }
    await pipeline(
      createReadStream(sourcePath),
      hashStream,
      createWriteStream(snapshotPath, { flags: "wx", mode: 0o600 }),
    );
    if (hash.digest("hex") !== expectedSha512) {
      throw new Error("release.artifact_mismatch: tarball does not match the current clean source");
    }
    return {
      path: snapshotPath,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

export async function createReleaseSourceSnapshot(identity) {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-source-"));
  const sourceRoot = join(root, "source");
  const archivePath = join(root, "source.tar");
  try {
    if (process.platform === "win32") await hardenWindowsSnapshotDirectory(root);
    await mkdir(sourceRoot);
    const archived = await runGit([
      "archive",
      "--format=tar",
      `--output=${archivePath}`,
      identity.commit,
    ]);
    if (archived.exitCode !== 0) throw commandError("release.source_archive_failed", archived);
    const extracted = await runCommand(
      process.platform === "win32" ? windowsSystemExecutable("tar.exe") : "tar",
      ["-xf", archivePath, "-C", sourceRoot],
    );
    if (extracted.exitCode !== 0) throw commandError("release.source_extract_failed", extracted);
    await rm(archivePath, { force: true });
    const packageJson = JSON.parse(await readFile(join(sourceRoot, "package.json"), "utf8"));
    if (packageJson.version !== identity.version) {
      throw new Error(`release.source_version_mismatch: expected ${identity.version}, received ${packageJson.version}`);
    }
    await mkdir(join(root, "npm-cache"));
    const installed = await runNpm([
      "ci",
      "--ignore-scripts",
      "--include=dev",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--registry",
      REGISTRY,
      "--cache",
      join(root, "npm-cache"),
    ], sourceRoot);
    if (installed.exitCode !== 0) throw commandError("release.source_dependency_install_failed", installed);
    return {
      root: sourceRoot,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (cause) {
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

export async function hardenWindowsSnapshotDirectory(root) {
  const directory = resolve(root);
  const whoami = windowsSystemExecutable("whoami.exe");
  const icacls = windowsSystemExecutable("icacls.exe");
  let identity;
  try {
    identity = await execFileAsync(whoami, ["/user", "/fo", "csv", "/nh"], windowsExecOptions());
  } catch (cause) {
    throw new Error("release.snapshot_acl_identity_failed", { cause });
  }
  const match = identity.stdout.trim().match(/^"((?:""|[^"])*)","(S-\d+(?:-\d+)+)"\s*$/u);
  if (!match) throw new Error("release.snapshot_acl_identity_invalid");
  const accountName = match[1].replaceAll('""', '"');
  const sid = match[2];

  try {
    await execFileAsync(icacls, [
      directory,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(OI)(CI)F`,
      "*S-1-5-18:(OI)(CI)F",
      "*S-1-5-32-544:(OI)(CI)F",
    ], windowsExecOptions());
  } catch (cause) {
    throw new Error("release.snapshot_acl_hardening_failed", { cause });
  }

  let acl;
  try {
    acl = await execFileAsync(icacls, [directory], windowsExecOptions());
  } catch (cause) {
    throw new Error("release.snapshot_acl_verification_failed", { cause });
  }
  const entries = parseIcaclsEntries(acl.stdout, directory);
  const expected = [
    [accountName, sid],
    ["NT AUTHORITY\\SYSTEM", "S-1-5-18"],
    ["BUILTIN\\Administrators", "S-1-5-32-544"],
  ];
  const isExpectedPrincipal = (principal, aliases) => aliases.some(
    (alias) => normalizeWindowsPrincipal(principal) === normalizeWindowsPrincipal(alias),
  );
  if (
    entries.length !== expected.length
    || entries.some(({ permissions }) => !permissions.includes("(F)") || permissions.includes("(I)"))
    || expected.some((aliases) => entries.filter(({ principal }) => isExpectedPrincipal(principal, aliases)).length !== 1)
  ) {
    throw new Error("release.snapshot_acl_invalid");
  }
  return { accountName, sid, entries };
}

function windowsSystemExecutable(filename) {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!windowsRoot) throw new Error("release.windows_root_missing");
  return join(windowsRoot, "System32", filename);
}

function windowsExecOptions() {
  return {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  };
}

function parseIcaclsEntries(stdout, directory) {
  const normalizedDirectory = directory.toLocaleLowerCase("en-US");
  const entries = [];
  for (const line of stdout.split(/\r?\n/u)) {
    let value = line.trim();
    if (value.toLocaleLowerCase("en-US").startsWith(normalizedDirectory)) {
      value = value.slice(directory.length).trim();
    }
    const separator = value.indexOf(":(");
    if (separator <= 0) continue;
    entries.push({
      principal: value.slice(0, separator),
      permissions: value.slice(separator + 1),
    });
  }
  return entries;
}

function normalizeWindowsPrincipal(principal) {
  return principal.replace(/^\*/u, "").toLocaleLowerCase("en-US");
}

async function buildSourceArtifactSha512(name, version, identity) {
  if (identity?.commit === undefined || identity.version !== version) {
    throw new Error("release.source_identity_missing");
  }
  const snapshot = await createReleaseSourceSnapshot(identity);
  try {
    const packageRoot = join(snapshot.root, "artifacts", "npm-release-verification", "package");
    const releaseRoot = join(snapshot.root, "artifacts", "npm-release-verification", "release");
    await mkdir(releaseRoot, { recursive: true });
    if (name === "agent-computer-use-mcp") {
      const built = await runCommand(
        process.execPath,
        [join(snapshot.root, "scripts", "pack-protected-npm-package.mjs")],
        snapshot.root,
      );
      if (built.exitCode !== 0) throw commandError("release.source_core_build_failed", built);
      const report = JSON.parse(built.stdout);
      assertBuiltIdentity(report.packageName, report.packageVersion, name, version);
      return fileSha512(report.tarballPath);
    }

    const built = await runCommand(process.execPath, [
      join(snapshot.root, "scripts", "build-windows-platform-package.mjs"),
      "--output",
      packageRoot,
      "--version",
      version,
      "--source-commit",
      identity.commit,
      "--cache-root",
      join(snapshot.root, "artifacts", "release-cache"),
      "--allow-network",
    ], snapshot.root);
    if (built.exitCode !== 0) throw commandError("release.source_platform_build_failed", built);
    const packed = await runNpm(
      ["pack", packageRoot, "--json", "--pack-destination", releaseRoot],
      snapshot.root,
    );
    if (packed.exitCode !== 0) throw commandError("release.npm_pack_failed", packed);
    const [report] = JSON.parse(packed.stdout);
    assertBuiltIdentity(report.name, report.version, name, version);
    return fileSha512(join(releaseRoot, report.filename));
  } finally {
    await snapshot.cleanup();
  }
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

function runNpm(args, cwd = process.cwd()) {
  const npm = resolveNpmCli();
  return runCommand(npm.command, [...npm.prefixArgs, ...args], cwd);
}

function runCommand(command, args, cwd = process.cwd()) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
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
