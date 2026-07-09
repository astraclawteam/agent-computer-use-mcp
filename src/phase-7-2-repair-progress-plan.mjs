import { createRepairProgressPlan, cancelRepairProgressPlan } from "./repair-progress-plan.mjs";

const repairPlan = {
  mode: "plan-only",
  requiresApproval: true,
  actions: [
    { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
    { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
    { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
    { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
  ],
};

const waiting = createRepairProgressPlan({
  repairPlan,
  approval: { status: "pending", token: "phase-7-2" },
  approved: false,
  dryRun: false,
  operationId: "phase-7-2-waiting",
});
const approved = createRepairProgressPlan({
  repairPlan,
  approval: { status: "approved", token: "phase-7-2" },
  approved: true,
  dryRun: false,
  operationId: "phase-7-2-approved",
});
const cancelled = cancelRepairProgressPlan(waiting, { reason: "phase-smoke" });
const passed = waiting.status === "waiting_for_approval"
  && approved.status === "ready_to_execute"
  && cancelled.status === "cancelled"
  && waiting.downloadOnFirstEnable === false
  && waiting.startsDesktopControl === false
  && waiting.includeUserOverlay === false
  && waiting.policy.longOperationsRequireProgress === true
  && waiting.policy.requiresApprovalBeforeNetwork === true
  && approved.executesImmediately === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "7.2",
  benchmark: "repair-progress-plan",
  waitingStatus: waiting.status,
  approvedStatus: approved.status,
  cancelledStatus: cancelled.status,
  eventStates: waiting.events.map((event) => event.state),
  actionProgressKinds: waiting.actions.map((action) => action.progressKind),
  downloadOnFirstEnable: waiting.downloadOnFirstEnable,
  startsDesktopControl: waiting.startsDesktopControl,
  includeUserOverlay: waiting.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
