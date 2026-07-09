import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getInstallLayout } from "./package-foundation.mjs";

const MODULE_NAME = "agent-computer-use-mcp";

export function createDaemonLifecycleManager(options = {}) {
  const layout = getInstallLayout({
    platform: options.platform,
    env: options.env,
  });
  const runtimeRoot = options.runtimeRoot ?? layout.runtimeRoot;
  const processInfo = options.processInfo ?? {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const lockPath = options.lockPath ?? join(runtimeRoot, "daemon.lock.json");
  let heldLock = null;

  return {
    lockPath,

    async acquire({ role = "mcp-daemon" } = {}) {
      await mkdir(runtimeRoot, { recursive: true });
      const existing = await readLock(lockPath);
      if (existing) {
        if (isProcessAlive(existing.pid)) {
          return {
            status: "already_running",
            role,
            existing,
            current: buildLock({ role, processInfo }),
            lockPath,
            includeUserOverlay: false,
          };
        }
        await rm(lockPath, { force: true });
      }

      const lock = buildLock({ role, processInfo });
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
      heldLock = lock;
      return {
        status: "acquired",
        role,
        pid: lock.pid,
        lockPath,
        recoveredStaleLock: existing ?? null,
        includeUserOverlay: false,
      };
    },

    async release() {
      const existing = await readLock(lockPath);
      if (!existing) {
        heldLock = null;
        return {
          status: "not_held",
          lockPath,
          includeUserOverlay: false,
        };
      }
      if (!heldLock) {
        return {
          status: "not_owner",
          existing,
          lockPath,
          includeUserOverlay: false,
        };
      }
      if (heldLock && existing.pid !== heldLock.pid) {
        return {
          status: "owned_by_other_process",
          existing,
          lockPath,
          includeUserOverlay: false,
        };
      }
      await rm(lockPath, { force: true });
      heldLock = null;
      return {
        status: "released",
        lockPath,
        includeUserOverlay: false,
      };
    },
  };
}

function buildLock({ role, processInfo }) {
  return {
    module: MODULE_NAME,
    role,
    pid: processInfo.pid,
    startedAt: processInfo.startedAt ?? new Date().toISOString(),
    includeUserOverlay: false,
  };
}

async function readLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
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
