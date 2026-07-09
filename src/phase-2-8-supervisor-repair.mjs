import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const supervisor = createSupervisorDouble();
const router = new ComputerUseProviderRouter({ processSupervisor: supervisor });

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
  && doctor.runtimeSupervisor?.status === "degraded"
  && doctor.repairPlan.actions.some((action) => action.id === "restart-ocr-sidecar")
  && planned.status === "approval_required"
  && planned.executesImmediately === false
  && repaired.status === "repaired"
  && repaired.executesImmediately === true
  && repaired.execution.results[0]?.status === "restarted"
  && repaired.includeUserOverlay === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.8",
  benchmark: "supervisor-doctor-repair",
  doctorDegraded: doctor.status === "degraded",
  recoverActionExposed: doctor.repairPlan.actions.some((action) => action.id === "restart-ocr-sidecar"),
  restartExecutedAfterApproval: repaired.execution.results[0]?.status === "restarted",
  includeUserOverlay: repaired.includeUserOverlay,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;

function createSupervisorDouble() {
  return {
    health() {
      return {
        status: "degraded",
        children: [
          {
            name: "ocr-sidecar",
            status: "crashed",
            pid: 1001,
            recoverAction: "restart-ocr-sidecar",
            includeUserOverlay: false,
          },
        ],
        recoverActions: [
          {
            id: "restart-ocr-sidecar",
            kind: "process-restart",
            child: "ocr-sidecar",
            reason: "crashed",
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
        executesImmediately: true,
        includeUserOverlay: false,
      };
    },
  };
}
