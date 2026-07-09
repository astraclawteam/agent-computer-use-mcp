import { readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { getInstallLayout } from "./package-foundation.mjs";

const DEFAULT_MAX_RUNTIME_FILE_AGE_MS = 6 * 60 * 60 * 1000;
const DAEMON_LOCK_NAME = "daemon.lock.json";

export async function cleanupRuntimeState(options = {}) {
  const layout = getInstallLayout({
    platform: options.platform,
    env: options.env,
  });
  const runtimeRoot = resolve(options.runtimeRoot ?? layout.runtimeRoot);
  const nowMs = options.nowMs ?? Date.now();
  const maxRuntimeFileAgeMs = options.maxRuntimeFileAgeMs ?? DEFAULT_MAX_RUNTIME_FILE_AGE_MS;
  const dryRun = options.dryRun !== false;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const files = await listFilesUnderRoot(runtimeRoot);
  const staleLocks = [];
  const activeLocks = [];
  const expired = [];

  for (const file of files) {
    if (file.name === DAEMON_LOCK_NAME) {
      const lock = await readDaemonLock(file.path);
      if (lock?.pid && isProcessAlive(lock.pid)) {
        activeLocks.push({
          path: file.path,
          pid: lock.pid,
          role: lock.role ?? "unknown",
          reason: "active-daemon-lock",
        });
        continue;
      }
      staleLocks.push({
        path: file.path,
        pid: lock?.pid ?? null,
        role: lock?.role ?? "unknown",
        reason: "stale-daemon-lock",
      });
      continue;
    }

    if (file.mtimeMs <= nowMs - maxRuntimeFileAgeMs) {
      expired.push({
        path: file.path,
        mtime: new Date(file.mtimeMs).toISOString(),
        reason: "expired-runtime-file",
      });
    }
  }

  const planned = [...staleLocks, ...expired];
  const deleted = [];
  if (!dryRun) {
    for (const entry of planned) {
      await rm(entry.path, { force: true });
      deleted.push(entry);
    }
  }

  return {
    status: dryRun ? "planned" : "completed",
    phase: "2.12",
    runtimeRoot,
    staleLocks,
    activeLocks,
    expired,
    deleted,
    deletedCount: deleted.length,
    dryRun,
    maxRuntimeFileAgeMs,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

async function listFilesUnderRoot(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (!isWithinRoot(root, path)) {
      throw new Error("runtime_cleanup_path_escape");
    }
    if (entry.isDirectory()) {
      files.push(...await listFilesUnderRoot(path));
    } else if (entry.isFile()) {
      const info = await stat(path);
      files.push({
        path,
        name: entry.name,
        mtimeMs: info.mtimeMs,
      });
    }
  }
  return files;
}

async function readDaemonLock(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function isWithinRoot(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}

function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
