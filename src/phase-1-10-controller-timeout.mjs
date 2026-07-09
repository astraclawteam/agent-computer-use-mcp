import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";

let now = 1_000;
const overlayCalls = [];
const actionCalls = [];
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
        bounds: { x: 10, y: 20, width: 300, height: 180 },
      };
    },
    async capture() {
      return {
        observationId: "obs-phase-1-10",
        elements: [{ elementToken: "save", role: "Button", name: "Save" }],
        includeUserOverlay: false,
      };
    },
    async click(args) {
      actionCalls.push(args);
      return { status: "ok" };
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

const access = await router.requestAccess({
  titlePart: "Computer Use Lab",
  tier: "full",
  leaseTtlMs: 50,
});
await router.capture({ mode: "semantic" });
now = 1_051;

let expiredActionDenied = false;
try {
  await router.act({ action: { kind: "click", elementToken: "save" } });
} catch (error) {
  expiredActionDenied = error?.code === "controller.expired";
}

const state = await router.listState();
const passed = access.controller.expiresAt === new Date(1_050).toISOString()
  && expiredActionDenied
  && overlayCalls.join(",") === "start,stop"
  && state.activeController === null
  && state.lastCapture === null
  && actionCalls.length === 0;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "1.10",
  benchmark: "controller-lease-timeout",
  expiredActionDenied,
  overlayStopped: overlayCalls.includes("stop"),
  staleControllerCleared: state.activeController === null,
  lastCaptureCleared: state.lastCapture === null,
  actionExecutedAfterExpiry: actionCalls.length > 0,
  includeUserOverlay: false,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;
