import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const daemonSession = createDaemonSessionDouble();
const router = new ComputerUseProviderRouter({ daemonSession });

const doctor = await router.doctor({
  fast: true,
  includeInstallCache: false,
});
const planned = await router.repair({
  approved: false,
  dryRun: false,
  actionIds: ["restart-ocr-sidecar"],
  includeInstallCache: false,
});
const repaired = await router.repair({
  approved: true,
  dryRun: false,
  actionIds: ["restart-ocr-sidecar"],
  includeInstallCache: false,
});

const passed = doctor.status === "degraded"
  && doctor.daemonSession?.status === "degraded"
  && doctor.repairPlan.actions.some((action) => action.id === "restart-ocr-sidecar")
  && planned.status === "approval_required"
  && planned.executesImmediately === false
  && repaired.status === "repaired"
  && repaired.executesImmediately === true
  && repaired.execution.results[0]?.status === "restarted"
  && repaired.includeUserOverlay === false
  && repaired.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.11",
  benchmark: "daemon-session-doctor-repair",
  daemonSessionReported: doctor.daemonSession?.status === "degraded",
  repairActionPlanned: doctor.repairPlan.actions.some((action) => action.id === "restart-ocr-sidecar"),
  approvedRepairRecovered: repaired.execution.results[0]?.status === "restarted",
  includeUserOverlay: repaired.includeUserOverlay,
  startsDesktopControl: repaired.startsDesktopControl,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;

function createDaemonSessionDouble() {
  return {
    health() {
      return {
        status: "degraded",
        lock: { status: "held", role: "mcp-daemon" },
        children: [
          {
            name: "ocr-sidecar",
            status: "crashed",
            pid: 1001,
            includeUserOverlay: false,
          },
        ],
        recoverActions: [
          {
            id: "restart-ocr-sidecar",
            kind: "process-restart",
            child: "ocr-sidecar",
            reason: "crashed",
            source: "daemon-session",
            executesImmediately: false,
          },
        ],
        includeUserOverlay: false,
      };
    },
    recover(actionId) {
      return {
        status: "restarted",
        actionId,
        child: "ocr-sidecar",
        source: "daemon-session",
        executesImmediately: true,
        includeUserOverlay: false,
      };
    },
  };
}
