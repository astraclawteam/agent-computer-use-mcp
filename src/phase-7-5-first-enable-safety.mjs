import { buildFirstEnableSafetyPlan, validateFirstEnableSafetyPlan } from "./first-enable-safety.mjs";

const doctor = {
  status: "degraded",
  repairPlan: {
    mode: "plan-only",
    requiresApproval: true,
    actions: [
      { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
      { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
    ],
  },
};

const plan = buildFirstEnableSafetyPlan({
  doctor,
  maxFirstEnableWaitMs: 15000,
});
const validation = validateFirstEnableSafetyPlan(plan);

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "7.5",
  benchmark: "first-enable-safety",
  firstEnableStatus: plan.status,
  maxFirstEnableWaitMs: plan.maxFirstEnableWaitMs,
  downloadOnFirstEnable: plan.downloadOnFirstEnable,
  networkAllowedBeforeApproval: plan.networkAllowedBeforeApproval,
  requiresUserApproval: plan.requiresUserApproval,
  userVisibleProgressRequired: plan.userVisibleProgressRequired,
  repairProgressPhase: plan.repairProgress.phase,
  repairProgressStatus: plan.repairProgress.status,
  repairTimeoutMs: plan.repairProgress.policy.timeoutMs,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
