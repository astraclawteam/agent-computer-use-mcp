import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupRuntimeState } from "./runtime-cleanup.mjs";

const nowMs = Date.parse("2026-07-09T00:00:00.000Z");
const hourMs = 60 * 60 * 1000;
const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-12-"));
await mkdir(join(runtimeRoot, "overlay"), { recursive: true });
const staleLock = await createJsonFile(runtimeRoot, "daemon.lock.json", {
  module: "agent-computer-use-mcp",
  role: "mcp-daemon",
  pid: 21212,
  startedAt: "2026-07-08T00:00:00.000Z",
  includeUserOverlay: false,
}, nowMs - hourMs);
const expiredRuntimeFile = await createFile(join(runtimeRoot, "overlay"), "target-rect.json", nowMs - 4 * hourMs);
const cleanup = await cleanupRuntimeState({
  runtimeRoot,
  nowMs,
  maxRuntimeFileAgeMs: hourMs,
  dryRun: false,
  isProcessAlive: (pid) => pid !== 21212,
});

const dryRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-12-dry-"));
const activeLock = await createJsonFile(dryRoot, "daemon.lock.json", {
  module: "agent-computer-use-mcp",
  role: "mcp-daemon",
  pid: 21213,
  startedAt: "2026-07-08T00:00:00.000Z",
  includeUserOverlay: false,
}, nowMs - 4 * hourMs);
const dryExpiredFile = await createFile(dryRoot, "old-target-rect.json", nowMs - 4 * hourMs);
const dryRun = await cleanupRuntimeState({
  runtimeRoot: dryRoot,
  nowMs,
  maxRuntimeFileAgeMs: hourMs,
  dryRun: true,
  isProcessAlive: (pid) => pid === 21213,
});

const staleLockRemoved = !(await exists(staleLock));
const expiredRuntimeFileRemoved = !(await exists(expiredRuntimeFile));
const activeLockPreserved = await exists(activeLock);
const dryRunPreservedExpiredFile = dryRun.status === "planned"
  && dryRun.expired.length === 1
  && await exists(dryExpiredFile);

const passed = cleanup.status === "completed"
  && cleanup.deletedCount === 2
  && staleLockRemoved
  && expiredRuntimeFileRemoved
  && activeLockPreserved
  && dryRunPreservedExpiredFile
  && cleanup.includeUserOverlay === false
  && cleanup.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.12",
  benchmark: "runtime-cleanup",
  staleLockRemoved,
  expiredRuntimeFileRemoved,
  activeLockPreserved,
  dryRunPreservedExpiredFile,
  deletedCount: cleanup.deletedCount,
  includeUserOverlay: cleanup.includeUserOverlay,
  startsDesktopControl: cleanup.startsDesktopControl,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;

async function createFile(root, name, mtimeMs) {
  const path = join(root, name);
  await writeFile(path, "runtime", "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function createJsonFile(root, name, payload, mtimeMs) {
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
