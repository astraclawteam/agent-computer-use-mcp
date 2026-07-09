import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

let now = 1_000;
let startsDesktopControlBeforeApproval = false;
const router = new ComputerUseProviderRouter({
  clock: {
    now: () => now,
    iso: (timeMs = now) => new Date(timeMs).toISOString(),
  },
  driver: {
    async findWindow() {
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        processName: "lab.exe",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
  },
  overlayRuntime: {
    async start() {
      return { visible: true, processId: 99 };
    },
    async stop() {},
  },
});

const pending = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  agentId: "phase-1-12",
  approvalRequired: true,
  approvalTtlMs: 50,
});
startsDesktopControlBeforeApproval = pending.startsDesktopControl === true || pending.overlay !== null;
const approved = await router.approveAccess({
  approvalToken: pending.approval.token,
  approved: true,
  leaseTtlMs: 50,
});

await router.cancel({ reason: "phase-1-12-reset" });
const deniedPending = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  approvalRequired: true,
});
let duplicatePendingBlocked = false;
try {
  await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    approvalRequired: true,
  });
} catch (error) {
  duplicatePendingBlocked = error?.code === "controller.approval_pending";
}
const denied = await router.approveAccess({
  approvalToken: deniedPending.approval.token,
  denied: true,
});

const cancelPending = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  approvalRequired: true,
});
const cancelled = await router.cancel({ reason: "phase-1-12-cancel" });

const revokePending = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  approvalRequired: true,
});
const revoked = await router.revoke({ reason: "phase-1-12-revoke" });

const timeoutPending = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  approvalRequired: true,
  approvalTtlMs: 10,
});
now += 11;
const expired = await router.approveAccess({
  approvalToken: timeoutPending.approval.token,
  approved: true,
});

const passed = approved.status === "granted"
  && denied.status === "approval_denied"
  && duplicatePendingBlocked
  && cancelled.previousApproval?.token === cancelPending.approval.token
  && revoked.previousApproval?.token === revokePending.approval.token
  && expired.status === "approval_expired"
  && startsDesktopControlBeforeApproval === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "1.12",
  benchmark: "control-approval-state",
  approveGrantsControl: approved.status === "granted",
  denyBlocksControl: denied.status === "approval_denied",
  duplicatePendingBlocked,
  cancelClearsPending: cancelled.previousApproval?.token === cancelPending.approval.token,
  revokeClearsPending: revoked.previousApproval?.token === revokePending.approval.token,
  timeoutBlocksControl: expired.status === "approval_expired",
  startsDesktopControlBeforeApproval,
  includeUserOverlay: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
