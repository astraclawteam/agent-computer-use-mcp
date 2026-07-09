import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

let releaseFindWindow;
const findWindowGate = new Promise((resolve) => {
  releaseFindWindow = resolve;
});
const findWindowCalls = [];
const overlayCalls = [];
const router = new ComputerUseProviderRouter({
  driver: {
    async findWindow(args) {
      findWindowCalls.push(args);
      await findWindowGate;
      return {
        windowId: "lab",
        title: "Computer Use Lab",
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
  },
  overlayRuntime: {
    async start() {
      overlayCalls.push("start");
      return { visible: true, processId: 99 };
    },
    async stop() {
      overlayCalls.push("stop");
    },
  },
});

try {
  const first = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-a" })
    .then((value) => ({ ok: true, value }))
    .catch((error) => ({ ok: false, error }));
  const second = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-b" })
    .then((value) => ({ ok: true, value }))
    .catch((error) => ({ ok: false, error }));
  releaseFindWindow();

  const results = await Promise.all([first, second]);
  const state = await router.listState();
  const grantedCount = results.filter((result) => result.ok && result.value.status === "granted").length;
  const rejectedCount = results.filter((result) => !result.ok && result.error?.code === "controller.request_in_progress").length;
  const activeControllerCount = state.activeController ? 1 : 0;
  const overlayStartCount = overlayCalls.filter((call) => call === "start").length;

  const passed = grantedCount === 1
    && rejectedCount === 1
    && activeControllerCount === 1
    && overlayStartCount === 1
    && findWindowCalls.length === 1;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "5.0",
    benchmark: "concurrent-controller-guard",
    grantedCount,
    rejectedCount,
    activeControllerCount,
    findWindowCallCount: findWindowCalls.length,
    overlayStartCount,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "5.0",
    benchmark: "concurrent-controller-guard",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await router.close().catch(() => {});
}
