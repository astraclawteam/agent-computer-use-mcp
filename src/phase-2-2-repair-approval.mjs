import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

let nowMs = 1_000;
const router = new ComputerUseProviderRouter({
  clock: {
    now: () => nowMs,
    iso: (timeMs = nowMs) => new Date(timeMs).toISOString(),
  },
});

try {
  const pending = await router.repair({
    approved: false,
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 100,
  });
  nowMs = 1_101;
  const expired = await router.repair({
    approved: true,
    dryRun: false,
    approvalToken: pending.approval?.token,
  });
  const secondPending = await router.repair({
    approved: false,
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 100,
  });
  await router.revoke({ reason: "phase-2-2-smoke" });
  const stateAfterRevoke = await router.listState();

  const passed = pending.approval?.status === "pending"
    && expired.status === "approval_expired"
    && secondPending.approval?.status === "pending"
    && stateAfterRevoke.pendingRepairApproval === null
    && expired.executesImmediately === false
    && expired.includeUserOverlay === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "2.2",
    benchmark: "repair-approval-state",
    pendingStatus: pending.approval?.status,
    expiredStatus: expired.status,
    revokedPendingApproval: stateAfterRevoke.pendingRepairApproval,
    executesImmediately: expired.executesImmediately,
    includeUserOverlay: expired.includeUserOverlay,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "2.2",
    benchmark: "repair-approval-state",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await router.close().catch(() => {});
}
