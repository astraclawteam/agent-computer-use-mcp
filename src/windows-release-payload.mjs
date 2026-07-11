import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { materializeReleaseBundle } from "./release-bundle.mjs";
import { publishGatewayOverlay } from "./gateway-overlay-build-host.mjs";
import { selectProductionRuntime } from "./release-runtime-selector.mjs";
import { WINDOWS_X64_RELEASE_TARGET, assertReleaseTarget } from "./release-target.mjs";
import { ensureWindowsInstallerPublished } from "./windows-installer-host.mjs";

const SOURCE_PATTERN = /^(src|test|scripts|windows-installer|gateway-overlay|native-lab|ocr-sidecar)\//;

export async function buildWindowsReleasePayload(options = {}) {
  if (process.platform !== "win32") {
    throw releaseError("release.windows_required", "Windows release payload requires Windows");
  }
  const target = assertReleaseTarget(options.target ?? WINDOWS_X64_RELEASE_TARGET);
  const outputRoot = resolve(required(options.outputRoot, "release.output_root_missing"));
  const nodeArchivePath = resolve(required(options.nodeArchivePath, "release.node_archive_missing"));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const stageRoot = `${outputRoot}.payload-staging-${randomUUID()}`;
  const sourceRoot = join(stageRoot, "source");
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(sourceRoot, { recursive: true });

    const protectedRoot = join(stageRoot, "protected-package");
    await buildProtectedNpmPackage({ outputRoot: protectedRoot });
    const packageRoot = join(sourceRoot, "package");
    await cp(protectedRoot, packageRoot, { recursive: true });
    await installProductionDependencies(stageRoot, packageRoot);
    const runtimeSelection = await selectProductionRuntime({ packageRoot, target });

    const expandedNodeRoot = join(stageRoot, "expanded-node");
    await expandVerifiedZip({ archivePath: nodeArchivePath, destinationPath: expandedNodeRoot });
    const nodeExePaths = (await listRelativeFiles(expandedNodeRoot))
      .filter((path) => path.toLowerCase().endsWith("/node.exe") || path.toLowerCase() === "node.exe");
    if (nodeExePaths.length !== 1) {
      throw releaseError("release.node_layout_invalid", "Portable Node archive must contain exactly one node.exe");
    }
    const nodeDistributionRoot = dirname(join(expandedNodeRoot, nodeExePaths[0]));
    await copyDirectoryFiltered(
      nodeDistributionRoot,
      join(sourceRoot, "runtime", "node"),
      (path) => !/\.(?:cs|map|py|ts|tsx)$/iu.test(path),
    );

    const nativeRoot = join(stageRoot, "native");
    const overlayOutput = join(nativeRoot, "overlay");
    const installerPublication = await ensureWindowsInstallerPublished();
    await publishGatewayOverlay({ outputRoot: overlayOutput });
    await copyPublishOutput(dirname(installerPublication.exePath), join(sourceRoot, "bin"));
    await copyPublishOutput(overlayOutput, join(sourceRoot, "helpers", "overlay"));

    await writeFile(join(sourceRoot, "runtime-entrypoints.json"), `${JSON.stringify({
      schemaVersion: 1,
      platform: "windows-x64",
      mcp: {
        command: "runtime/node/node.exe",
        args: ["package/dist/launcher.mjs"],
      },
      installer: "bin/AgentComputerUse.Installer.exe",
      overlay: "helpers/overlay/GatewayComputerUseOverlay.exe",
      target,
      distributionStatus: "blocked_unsigned",
    }, null, 2)}\n`, "utf8");

    const files = await listRelativeFiles(sourceRoot);
    const bundleRoot = join(stageRoot, "release");
    const verification = await materializeReleaseBundle({
      packageName: packageJson.name,
      version: packageJson.version,
      sourceRoot,
      outputRoot: bundleRoot,
      files,
      generatedAt: options.generatedAt,
    });

    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(bundleRoot, outputRoot);
    const sourceEntryCount = files.filter(isSourceEntry).length;
    const sourceMapCount = files.filter((path) => path.endsWith(".map")).length;
    if (sourceEntryCount !== 0 || sourceMapCount !== 0) {
      throw releaseError("release.payload_contains_source", "Portable payload contains source or Source Maps");
    }
    return {
      status: "ready",
      platform: "windows-x64",
      target,
      runtimeSelection,
      distributionStatus: "blocked_unsigned",
      bundleRoot: outputRoot,
      installerPath: join(outputRoot, "payload", "bin", "AgentComputerUse.Installer.exe"),
      overlayRoot: join(outputRoot, "payload", "helpers", "overlay"),
      runtimeDescriptorPath: join(outputRoot, "payload", "runtime-entrypoints.json"),
      fileCount: verification.fileCount,
      files: verification.files,
      sourceEntryCount,
      sourceMapCount,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function expandVerifiedZip({ archivePath, destinationPath }) {
  const result = await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", resolve("scripts/expand-verified-zip.ps1"),
    "-ArchivePath", resolve(archivePath),
    "-DestinationPath", resolve(destinationPath),
  ]);
  if (result.exitCode !== 0) {
    const text = `${result.stderr}\n${result.stdout}`;
    const code = text.includes("release.zip_entry_invalid")
      ? "release.zip_entry_invalid"
      : "release.zip_extract_failed";
    throw releaseError(code, text.trim().slice(-1000));
  }
}

async function installProductionDependencies(stageRoot, packageRoot) {
  const dependencyRoot = join(stageRoot, "production-dependencies");
  await mkdir(dependencyRoot, { recursive: true });
  await cp("package.json", join(dependencyRoot, "package.json"));
  await cp("package-lock.json", join(dependencyRoot, "package-lock.json"));
  const npm = resolveNpmCli();
  const npmCacheResult = await runChecked(
    npm.command,
    [...npm.prefixArgs, "config", "get", "cache"],
    "release.npm_cache_unavailable",
  );
  const npmCache = npmCacheResult.stdout.trim();
  if (!npmCache) throw releaseError("release.npm_cache_unavailable", "npm cache path is empty");
  await runChecked(npm.command, [
    ...npm.prefixArgs,
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
    "--cache", npmCache,
    "--prefix", dependencyRoot,
  ], "release.production_dependencies_failed");
  await copyDirectoryFiltered(
    join(dependencyRoot, "node_modules"),
    join(packageRoot, "node_modules"),
    (path) => !path.endsWith(".map"),
  );
}

async function copyPublishOutput(source, target) {
  await mkdir(target, { recursive: true });
  for (const path of await listRelativeFiles(source)) {
    if (path.endsWith(".pdb")) continue;
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(source, path), destination);
  }
}

async function copyDirectoryFiltered(source, target, include) {
  for (const path of await listRelativeFiles(source)) {
    if (!include(path)) continue;
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(source, path), destination);
  }
}

async function listRelativeFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) files.push(relative(root, fullPath).replaceAll("\\", "/"));
      else throw releaseError("release.payload_link_forbidden", `Unsupported payload entry: ${entry.name}`);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function isSourceEntry(path) {
  if (path.startsWith("package/node_modules/")) return false;
  return SOURCE_PATTERN.test(path)
    || /\.(?:cs|csproj|py|ts|tsx)$/.test(path)
    || path.endsWith(".map");
}

function resolveNpmCli() {
  if (process.env.npm_execpath) return { command: process.execPath, prefixArgs: [process.env.npm_execpath] };
  return process.platform === "win32"
    ? { command: "cmd.exe", prefixArgs: ["/d", "/s", "/c", "npm"] }
    : { command: "npm", prefixArgs: [] };
}

async function runChecked(command, args, code) {
  const result = await runCommand(command, args);
  if (result.exitCode !== 0) {
    throw releaseError(code, (result.stderr || result.stdout).trim().slice(-4000));
  }
  return result;
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

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, code);
  return value;
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
