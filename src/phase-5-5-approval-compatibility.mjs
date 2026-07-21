import { COMPUTER_USE_MCP_TOOLS } from "./computer-use-mcp-tools.mjs";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const listStateTool = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.list_state");
const schemaDeclaresPendingAccessApproval = listStateTool
  ?.outputSchema
  ?.properties
  ?.pendingAccessApproval
  ?.anyOf
  ?.length === 2
  && listStateTool.outputSchema.allOf?.[0]?.else?.required?.includes("pendingAccessApproval");

const router = new ComputerUseProviderRouter({
  driver: {
    async findWindow() {
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        processName: "lab.exe",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
    async close() {},
  },
  overlayRuntime: {
    async start() {
      throw new Error("overlay must not start before approval");
    },
  },
});

let duplicatePendingRejected = false;
let startsDesktopControlBeforeApproval = false;

try {
  const pending = await router.requestAccess({
    titlePart: "Computer Use Lab",
    tier: "full",
    agentId: "phase-5-5-client-a",
    approvalRequired: true,
  });
  startsDesktopControlBeforeApproval = pending.startsDesktopControl === true || pending.overlay !== null;
  const stateWithPending = await router.listState();
  const pendingVisibleInState = stateWithPending.pendingAccessApproval?.token === pending.approval.token
    && stateWithPending.activeController === null;

  try {
    await router.requestAccess({
      titlePart: "Computer Use Lab",
      tier: "full",
      agentId: "phase-5-5-client-b",
      approvalRequired: true,
    });
  } catch (error) {
    duplicatePendingRejected = error?.code === "controller.approval_pending";
  }

  await router.close({ reason: "phase-5-5-disconnect" });
  const pendingClearedOnClose = router.pendingAccessApproval === null
    && router.auditEvents.some((event) => event.type === "computer.access.approval_closed");
  let closedListStateRejected = false;
  let closedApprovalRejected = false;
  try {
    await router.listState();
  } catch (error) {
    closedListStateRejected = error?.code === "lifecycle.closed";
  }
  try {
    await router.approveAccess({
      approvalToken: pending.approval.token,
      approved: true,
    });
  } catch (error) {
    closedApprovalRejected = error?.code === "lifecycle.closed";
  }
  const closedOperationsRejected = closedListStateRejected && closedApprovalRejected;

  const passed = schemaDeclaresPendingAccessApproval
    && pendingVisibleInState
    && duplicatePendingRejected
    && pendingClearedOnClose
    && closedOperationsRejected
    && startsDesktopControlBeforeApproval === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.5",
    benchmark: "approval-compatibility",
    schemaDeclaresPendingAccessApproval,
    pendingVisibleInState,
    duplicatePendingRejected,
    pendingClearedOnClose,
    closedOperationsRejected,
    startsDesktopControlBeforeApproval,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.5",
    benchmark: "approval-compatibility",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await router.close({ reason: "phase-5-5-finally" }).catch(() => {});
}
