import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const GATEWAY_OVERLAY_BUILD_LOCK = resolve("gateway-overlay/obj/agent-computer-use-overlay-build.lock");

export async function withGatewayOverlayBuildLock(operation, options = {}) {
  const lockPath = resolve(options.lockPath ?? GATEWAY_OVERLAY_BUILD_LOCK);
  const timeoutMs = options.timeoutMs ?? 600_000;
  const waitMs = options.waitMs ?? 100;
  const staleGraceMs = options.staleGraceMs ?? 10_000;
  const startedAt = Date.now();
  await mkdir(dirname(lockPath), { recursive: true });
  while (true) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
      try {
        return await operation();
      } finally {
        await handle.close();
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      if (await isStaleLock(lockPath, staleGraceMs)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) throw new Error("overlay.build_lock_timeout");
      await delay(waitMs);
    }
  }
}

export function buildGatewayOverlay(options = {}) {
  return withGatewayOverlayBuildLock(() => runChecked("dotnet", [
    "build",
    "gateway-overlay/GatewayComputerUseOverlay.csproj",
    "--configuration", options.configuration ?? "Debug",
    "--nologo",
  ], "overlay.build_failed"), options);
}

export function publishGatewayOverlay(options = {}) {
  const outputRoot = resolve(options.outputRoot);
  return withGatewayOverlayBuildLock(() => runChecked(
    "dotnet",
    createGatewayOverlayPublishArgs(outputRoot, options),
    "release.overlay_publish_failed",
  ), options);
}

export function createGatewayOverlayPublishArgs(outputRoot, options = {}) {
  return [
    "publish",
    "gateway-overlay/GatewayComputerUseOverlay.csproj",
    "--configuration", "Release",
    "--runtime", options.runtime ?? "win-x64",
    "--self-contained", "true",
    "--output", outputRoot,
    "--nologo",
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:EnableCompressionInSingleFile=true",
    "-p:DebugType=None",
  ];
}

export function runGatewayOverlayBehaviorHarness(options = {}) {
  return withGatewayOverlayBuildLock(() => runChecked("dotnet", [
    "run",
    "--project", "gateway-overlay-tests/GatewayComputerUseOverlay.Tests.csproj",
  ], "overlay.behavior_harness_failed"), options);
}

async function isStaleLock(lockPath, graceMs) {
  const lockStat = await stat(lockPath).catch(() => null);
  if (!lockStat || Date.now() - lockStat.mtimeMs <= graceMs) return false;
  try {
    const metadata = JSON.parse(await readFile(lockPath, "utf8"));
    if (Number.isSafeInteger(metadata.pid) && metadata.pid > 0) {
      try { process.kill(metadata.pid, 0); return false; } catch { return true; }
    }
  } catch {
    return true;
  }
  return true;
}

function runChecked(command, args, code) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolvePromise({ exitCode, stdout, stderr });
      else {
        const error = new Error(`${code}: ${(stderr || stdout).trim().slice(-4000)}`);
        error.code = code;
        reject(error);
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
