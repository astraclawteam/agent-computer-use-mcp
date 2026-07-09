import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const router = new ComputerUseProviderRouter();

try {
  const pending = await router.repair({
    dryRun: false,
    requestApproval: true,
    approvalTtlMs: 5000,
  });
  const denied = await router.repair({
    denied: true,
    approvalToken: pending.approval?.token,
    dryRun: false,
  });
  const state = await router.listState();

  const passed = pending.approval?.status === "pending"
    && denied.status === "approval_denied"
    && denied.approval?.status === "denied"
    && denied.executesImmediately === false
    && denied.execution?.status === "not_started"
    && state.pendingRepairApproval === null
    && denied.includeUserOverlay === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "2.9",
    benchmark: "repair-deny-state",
    pendingStatus: pending.approval?.status,
    deniedStatus: denied.status,
    pendingAfterDeny: state.pendingRepairApproval,
    executesImmediately: denied.executesImmediately,
    includeUserOverlay: denied.includeUserOverlay,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "2.9",
    benchmark: "repair-deny-state",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await router.close().catch(() => {});
}
