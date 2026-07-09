import { createFirstRunReadinessPlan } from "./first-run-readiness.mjs";
import { createRepairProgressPlan } from "./repair-progress-plan.mjs";

export function buildFirstEnableSafetyPlan(options = {}) {
  const doctor = options.doctor ?? {};
  const maxFirstEnableWaitMs = options.maxFirstEnableWaitMs ?? 15000;
  const firstRun = createFirstRunReadinessPlan({ doctor });
  const repairProgress = createRepairProgressPlan({
    repairPlan: doctor.repairPlan ?? { actions: [] },
    approval: { status: "pending", token: "first-enable" },
    approved: false,
    dryRun: false,
    operationId: "first-enable-safety",
  });
  const blocked = firstRun.status !== "ready";

  return {
    phase: "7.5",
    status: blocked ? "blocked" : "ready",
    mode: "first-enable-safety",
    maxFirstEnableWaitMs,
    firstRun,
    repairProgress,
    downloadOnFirstEnable: false,
    networkAllowedBeforeApproval: false,
    requiresUserApproval: blocked,
    userVisibleProgressRequired: true,
    hostMustScheduleRepairs: blocked,
    executesRepairsImmediately: false,
    timeoutPolicy: {
      firstEnableWaitMs: maxFirstEnableWaitMs,
      longRepairTimeoutMs: repairProgress.policy.timeoutMs,
      firstEnableBlocksBeforeLongRepair: repairProgress.policy.timeoutMs > maxFirstEnableWaitMs,
    },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function validateFirstEnableSafetyPlan(plan) {
  const violations = [];
  if (plan.downloadOnFirstEnable !== false) {
    violations.push({ code: "download-on-first-enable" });
  }
  if (plan.networkAllowedBeforeApproval !== false) {
    violations.push({ code: "network-before-approval" });
  }
  if (plan.executesRepairsImmediately !== false) {
    violations.push({ code: "repair-executes-immediately" });
  }
  if (plan.userVisibleProgressRequired !== true) {
    violations.push({ code: "missing-user-visible-progress" });
  }
  if (plan.repairProgress?.policy?.requiresApprovalBeforeNetwork !== true) {
    violations.push({ code: "repair-network-not-approval-gated" });
  }
  if (plan.repairProgress?.policy?.cancellable !== true) {
    violations.push({ code: "repair-not-cancellable" });
  }
  if (plan.timeoutPolicy?.firstEnableBlocksBeforeLongRepair !== true && plan.status === "blocked") {
    violations.push({ code: "first-enable-can-wait-on-long-repair" });
  }
  if (plan.startsDesktopControl !== false) {
    violations.push({ code: "first-enable-starts-desktop-control" });
  }
  if (plan.includeUserOverlay !== false) {
    violations.push({ code: "first-enable-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "7.5",
    violations,
    violationCount: violations.length,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}
