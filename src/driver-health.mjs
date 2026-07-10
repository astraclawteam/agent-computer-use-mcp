import { spawn } from "node:child_process";
import { resolveActiveAssetEntryPoint } from "./active-asset-state.mjs";

const DRIVER_BINARY = "cua-driver";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_DETAIL_LENGTH = 2000;

export function resolveCuaDriverCandidate(env = process.env, options = {}) {
  for (const key of [
    "AGENT_COMPUTER_USE_CUA_DRIVER",
    "AGENT_COMPUTER_USE_CUA_DRIVER_PATH",
    "XIAOZHICLAW_CUA_DRIVER",
    "XIAOZHICLAW_CUA_DRIVER_PATH",
    "CUA_DRIVER",
  ]) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  const resolveActiveAsset = options.resolveActiveAsset ?? resolveActiveAssetEntryPoint;
  return resolveActiveAsset("cua-driver-windows-x64", {
    env,
    platform: options.platform,
    programRoot: options.programRoot,
    statePath: options.statePath,
  });
}

export async function checkCuaDriverHealth(options = {}) {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const lookupOnPath = options.lookupOnPath ?? defaultLookupOnPath;
  const runDriver = options.runDriver ?? defaultRunDriver;
  let driverPath;
  try {
    driverPath = resolveCuaDriverCandidate(env) ?? await lookupOnPath(DRIVER_BINARY, env);
  } catch (error) {
    return {
      status: "unavailable",
      reason: "lookup-error",
      checkedAt,
      detail: truncateDetail(error instanceof Error ? error.message : String(error)),
    };
  }

  if (!driverPath) {
    return {
      status: "unavailable",
      reason: "not-found",
      checkedAt,
      detail: "cua-driver was not found in AGENT_COMPUTER_USE_CUA_DRIVER, AGENT_COMPUTER_USE_CUA_DRIVER_PATH, XIAOZHICLAW_CUA_DRIVER, XIAOZHICLAW_CUA_DRIVER_PATH, CUA_DRIVER, or PATH.",
    };
  }

  try {
    const result = await runDriver(driverPath, ["--version"], { env, timeoutMs });
    const detail = compactDetail(result);
    if (result.exitCode !== 0) {
      return {
        status: "unavailable",
        reason: "version-check-failed",
        driverPath,
        checkedAt,
        detail,
      };
    }

    return {
      status: "healthy",
      driverPath,
      checkedAt,
      version: firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr) ?? "unknown",
      detail,
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "probe-error",
      driverPath,
      checkedAt,
      detail: truncateDetail(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function defaultLookupOnPath(binaryName, env) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = await defaultRunDriver(command, [binaryName], { env, timeoutMs: DEFAULT_TIMEOUT_MS });
  if (result.exitCode !== 0) return null;
  return firstNonEmptyLine(result.stdout);
}

function defaultRunDriver(driverPath, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(driverPath, args, {
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`cua-driver probe timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function firstNonEmptyLine(value) {
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ?? null;
}

function compactDetail(result) {
  const lines = [
    result.stdout.trim() ? `stdout: ${result.stdout.trim()}` : "",
    result.stderr.trim() ? `stderr: ${result.stderr.trim()}` : "",
  ].filter(Boolean);
  return lines.length > 0 ? truncateDetail(lines.join("\n")) : undefined;
}

function truncateDetail(value) {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}...` : value;
}
