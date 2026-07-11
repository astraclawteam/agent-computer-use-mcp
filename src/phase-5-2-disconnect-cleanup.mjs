import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

const calls = [];
const router = new ComputerUseProviderRouter({
  driver: {
    async findWindow() {
      calls.push("findWindow");
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
    async capture() {
      calls.push("capture");
      return {
        observationId: "obs-disconnect-cleanup",
        elements: [{ token: "save", role: "button", name: "Save" }],
      };
    },
    async close() {
      calls.push("driver.close");
    },
  },
  overlayRuntime: {
    async start() {
      calls.push("overlay.start");
      return { visible: true, processId: 42 };
    },
    async stop() {
      calls.push("overlay.stop");
    },
  },
  processSupervisor: {
    health() {
      return {
        status: "degraded",
        recoverActions: [
          { id: "restart-overlay", kind: "process-restart", reason: "test" },
        ],
      };
    },
  },
});

try {
  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-a" });
  await router.capture({ mode: "semantic" });
  await router.repair({
    includeInstallCache: false,
    requestApproval: true,
    approvalTtlMs: 300000,
  });
  const beforeClose = await router.listState();
  await router.close({ reason: "client-disconnect" });
  let rejectsNewWork = false;
  try {
    await router.listState();
  } catch (error) {
    rejectsNewWork = error?.code === "lifecycle.closed";
  }
  const afterClose = {
    status: router.activeController ? "active" : "idle",
    activeController: router.activeController,
    lastCapture: router.lastCapture,
    pendingRepairApproval: router.pendingRepairApproval,
    auditEvents: router.auditEvents,
  };
  const overlayStopped = calls.includes("overlay.stop");

  const passed = beforeClose.status === "active"
    && afterClose.status === "idle"
    && afterClose.activeController === null
    && afterClose.lastCapture === null
    && afterClose.pendingRepairApproval === null
    && overlayStopped
    && rejectsNewWork
    && afterClose.auditEvents.some((event) => event.type === "computer.controller.closed");

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.2",
    benchmark: "disconnect-cleanup",
    activeBeforeClose: beforeClose.status === "active",
    idleAfterClose: afterClose.status === "idle",
    lastCaptureCleared: afterClose.lastCapture === null,
    pendingApprovalCleared: afterClose.pendingRepairApproval === null,
    overlayStopped,
    rejectsNewWork,
    driverClosed: calls.includes("driver.close"),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.2",
    benchmark: "disconnect-cleanup",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (process.exitCode) {
    await router.close({ reason: "cleanup-after-failure" }).catch(() => {});
  }
}
