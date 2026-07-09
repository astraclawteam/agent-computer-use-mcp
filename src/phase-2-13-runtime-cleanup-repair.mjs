import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const nowMs = Date.parse("2026-07-09T00:00:00.000Z");
const hourMs = 60 * 60 * 1000;
const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-13-"));
await mkdir(join(runtimeRoot, "overlay"), { recursive: true });
const staleLock = await createJsonFile(runtimeRoot, "daemon.lock.json", {
  module: "agent-computer-use-mcp",
  role: "mcp-daemon",
  pid: 21313,
  startedAt: "2026-07-08T00:00:00.000Z",
  includeUserOverlay: false,
}, nowMs - hourMs);
const expiredRuntimeFile = await createFile(join(runtimeRoot, "overlay"), "target-rect.json", nowMs - 4 * hourMs);

const router = new ComputerUseProviderRouter({
  runtimeCleanupOptions: {
    runtimeRoot,
    nowMs,
    maxRuntimeFileAgeMs: hourMs,
    isProcessAlive: (pid) => pid !== 21313,
  },
});

const doctor = await router.doctor({
  fast: true,
  includeInstallCache: false,
});
const planned = await router.repair({
  approved: false,
  dryRun: false,
  actionIds: ["cleanup-runtime-state"],
  includeInstallCache: false,
});
const repaired = await router.repair({
  approved: true,
  dryRun: false,
  actionIds: ["cleanup-runtime-state"],
  includeInstallCache: false,
});

const staleLockRemoved = !(await exists(staleLock));
const expiredRuntimeFileRemoved = !(await exists(expiredRuntimeFile));
const passed = doctor.status === "degraded"
  && doctor.runtimeCleanup?.status === "degraded"
  && doctor.repairPlan.actions.some((action) => action.id === "cleanup-runtime-state")
  && planned.status === "approval_required"
  && planned.execution.status === "not_started"
  && repaired.status === "repaired"
  && repaired.execution.results[0]?.status === "completed"
  && staleLockRemoved
  && expiredRuntimeFileRemoved
  && repaired.includeUserOverlay === false
  && repaired.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.13",
  benchmark: "runtime-cleanup-doctor-repair",
  runtimeCleanupReported: doctor.runtimeCleanup?.status === "degraded",
  repairActionPlanned: doctor.repairPlan.actions.some((action) => action.id === "cleanup-runtime-state"),
  approvedRepairCleaned: repaired.execution.results[0]?.status === "completed" && staleLockRemoved && expiredRuntimeFileRemoved,
  includeUserOverlay: repaired.includeUserOverlay,
  startsDesktopControl: repaired.startsDesktopControl,
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
