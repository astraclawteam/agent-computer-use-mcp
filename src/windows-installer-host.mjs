import { spawn } from "node:child_process";
import { open, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const WINDOWS_INSTALLER_PROJECT = resolve("windows-installer/AgentComputerUse.Installer.csproj");
export const WINDOWS_INSTALLER_DLL = resolve("windows-installer/bin/Release/net10.0/AgentComputerUse.Installer.dll");

const BUILD_LOCK = resolve("windows-installer/obj/agent-computer-use-installer-build.lock");
const LOCK_STALE_MS = 120_000;

export async function ensureWindowsInstallerBuilt(options = {}) {
  if (await installerBuildIsCurrent()) {
    return { status: "ready", built: false, dllPath: WINDOWS_INSTALLER_DLL };
  }

  const timeoutMs = options.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  await mkdir(dirname(BUILD_LOCK), { recursive: true });
  while (true) {
    const lock = await tryAcquireBuildLock();
    if (lock) {
      try {
        if (await installerBuildIsCurrent()) {
          return { status: "ready", built: false, dllPath: WINDOWS_INSTALLER_DLL };
        }
        const build = await runCommand("dotnet", [
          "build",
          WINDOWS_INSTALLER_PROJECT,
          "--configuration",
          "Release",
          "--nologo",
        ]);
        if (build.exitCode !== 0) {
          throw new Error(`installer.build_failed: ${build.stderr || build.stdout}`);
        }
        return { status: "ready", built: true, dllPath: WINDOWS_INSTALLER_DLL };
      } finally {
        await lock.close();
        await rm(BUILD_LOCK, { force: true });
      }
    }

    if (await lockIsStale()) {
      await rm(BUILD_LOCK, { force: true });
      continue;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("installer.build_lock_timeout: timed out waiting for native installer build");
    }
    await delay(100);
  }
}

export async function runWindowsInstaller(operation, options = {}) {
  const build = await ensureWindowsInstallerBuilt(options);
  const args = [
    build.dllPath,
    operation,
    "--program-root",
    options.programRoot,
    "--data-root",
    options.dataRoot,
  ];
  if (options.bundleRoot) args.push("--bundle", options.bundleRoot);
  if (options.manifestPath) args.push("--manifest", options.manifestPath);
  if (options.signaturePath) args.push("--signature", options.signaturePath);
  if (options.keyringPath) args.push("--trust-keyring", options.keyringPath);
  if (options.offlineRoot) args.push("--offline-root", options.offlineRoot);
  if (options.assetIds?.length) args.push("--asset-ids", options.assetIds.join(","));
  if (options.releaseId) args.push("--release-id", options.releaseId);
  if (options.operationId) args.push("--operation-id", options.operationId);
  if (options.allowNetwork === true) args.push("--allow-network", "true");
  const result = await runCommand("dotnet", args);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`installer.output_invalid: ${result.stderr || result.stdout}`);
  }
  return { ...result, report };
}

async function installerBuildIsCurrent() {
  const dllStat = await stat(WINDOWS_INSTALLER_DLL).catch(() => null);
  if (!dllStat?.isFile()) return false;

  const sourceRoot = dirname(WINDOWS_INSTALLER_PROJECT);
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith(".cs") && !entry.name.endsWith(".csproj"))) continue;
    const sourceStat = await stat(join(sourceRoot, entry.name));
    if (sourceStat.mtimeMs > dllStat.mtimeMs) return false;
  }
  return true;
}

async function tryAcquireBuildLock() {
  try {
    const handle = await open(BUILD_LOCK, "wx");
    await handle.writeFile(`${process.pid}\n`, "utf8");
    return handle;
  } catch (error) {
    if (error?.code === "EEXIST") return null;
    throw error;
  }
}

async function lockIsStale() {
  const lockStat = await stat(BUILD_LOCK).catch(() => null);
  return Boolean(lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS);
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
