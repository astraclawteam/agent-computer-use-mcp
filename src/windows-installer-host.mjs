import { spawn } from "node:child_process";
import { open, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

export const WINDOWS_INSTALLER_PROJECT = resolve("windows-installer/AgentComputerUse.Installer.csproj");
export const WINDOWS_INSTALLER_DLL = resolve("windows-installer/bin/Release/net10.0/AgentComputerUse.Installer.dll");
export const WINDOWS_INSTALLER_NATIVE_EXE = resolve("artifacts/windows-installer/win-x64/AgentComputerUse.Installer.exe");

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
        ], { env: options.env, signal: options.signal });
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

export async function ensureWindowsInstallerPublished(options = {}) {
  if (await installerOutputIsCurrent(WINDOWS_INSTALLER_NATIVE_EXE)) {
    return { status: "ready", published: false, exePath: WINDOWS_INSTALLER_NATIVE_EXE };
  }

  const timeoutMs = options.timeoutMs ?? 180_000;
  const startedAt = Date.now();
  await mkdir(dirname(BUILD_LOCK), { recursive: true });
  while (true) {
    const lock = await tryAcquireBuildLock();
    if (lock) {
      try {
        if (await installerOutputIsCurrent(WINDOWS_INSTALLER_NATIVE_EXE)) {
          return { status: "ready", published: false, exePath: WINDOWS_INSTALLER_NATIVE_EXE };
        }
        await mkdir(dirname(WINDOWS_INSTALLER_NATIVE_EXE), { recursive: true });
        const publish = await runCommand("dotnet", [
          "publish",
          WINDOWS_INSTALLER_PROJECT,
          "--configuration",
          "Release",
          "--runtime",
          "win-x64",
          "--self-contained",
          "true",
          "--output",
          dirname(WINDOWS_INSTALLER_NATIVE_EXE),
          "--nologo",
        ], { env: options.env, signal: options.signal });
        if (publish.exitCode !== 0) {
          throw new Error(`installer.publish_failed: ${publish.stderr || publish.stdout}`);
        }
        return { status: "ready", published: true, exePath: WINDOWS_INSTALLER_NATIVE_EXE };
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
      throw new Error("installer.publish_lock_timeout: timed out waiting for native installer publish");
    }
    await delay(100);
  }
}

export async function runWindowsInstaller(operation, options = {}) {
  const launch = options.installerPath
    ? installedHelperLaunch(options.installerPath)
    : developmentHelperLaunch(await ensureWindowsInstallerBuilt(options));
  const args = [
    ...launch.prefixArgs,
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
  const records = [];
  let progressQueue = Promise.resolve();
  const result = await runCommand(launch.command, args, {
    env: options.env,
    signal: options.signal,
    onStdoutLine(line) {
      const record = parseInstallerLine(line);
      if (!record) return;
      records.push(record);
      if (record.type === "progress" && options.onProgress) {
        progressQueue = progressQueue.then(() => options.onProgress(record));
      }
    },
  });
  await progressQueue;
  let report;
  report = [...records].reverse().find((record) => record.type !== "progress");
  if (!report) throw new Error(`installer.output_invalid: ${result.stderr || result.stdout}`);
  return { ...result, report };
}

function installedHelperLaunch(installerPath) {
  const path = resolve(installerPath);
  return extname(path).toLowerCase() === ".dll"
    ? { command: "dotnet", prefixArgs: [path] }
    : { command: path, prefixArgs: [] };
}

function developmentHelperLaunch(build) {
  return { command: "dotnet", prefixArgs: [build.dllPath] };
}

async function installerBuildIsCurrent() {
  return installerOutputIsCurrent(WINDOWS_INSTALLER_DLL);
}

async function installerOutputIsCurrent(outputPath) {
  const outputStat = await stat(outputPath).catch(() => null);
  if (!outputStat?.isFile()) return false;

  const sourceRoot = dirname(WINDOWS_INSTALLER_PROJECT);
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith(".cs") && !entry.name.endsWith(".csproj"))) continue;
    const sourceStat = await stat(join(sourceRoot, entry.name));
    if (sourceStat.mtimeMs > outputStat.mtimeMs) return false;
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

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      signal: options.signal,
    });
    let stdout = "";
    let stdoutLineBuffer = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutLineBuffer += text;
      let newlineIndex;
      while ((newlineIndex = stdoutLineBuffer.indexOf("\n")) >= 0) {
        const line = stdoutLineBuffer.slice(0, newlineIndex).replace(/\r$/, "");
        stdoutLineBuffer = stdoutLineBuffer.slice(newlineIndex + 1);
        if (line) options.onStdoutLine?.(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (stdoutLineBuffer) options.onStdoutLine?.(stdoutLineBuffer.replace(/\r$/, ""));
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

function parseInstallerLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
