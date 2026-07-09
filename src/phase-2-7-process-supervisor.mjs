import {
  createProcessSupervisor,
  getComputerUseChildProcessSpecs,
} from "./process-supervisor.mjs";

const factory = createFakeProcessFactory();
const supervisor = createProcessSupervisor({ processFactory: factory });
const specs = getComputerUseChildProcessSpecs();

const overlay = supervisor.ensure("overlay", specs.overlay);
supervisor.ensure("ocr-sidecar", specs["ocr-sidecar"]);
const driver = supervisor.ensure("cua-driver-mcp", specs["cua-driver-mcp"]);

overlay.handle.emitExit(42, null);
const degraded = supervisor.health();
const planned = supervisor.recover("restart-overlay", { approved: false });
const restarted = supervisor.recover("restart-overlay", { approved: true });
const recovered = supervisor.health();

driver.handle.emitExit(2, null);
const driverDegraded = supervisor.health();
const driverPlan = driverDegraded.recoverActions.find((action) => action.id === "restart-cua-driver-mcp");

const passed = degraded.status === "degraded"
  && planned.status === "approval_required"
  && planned.executesImmediately === false
  && restarted.status === "restarted"
  && recovered.status === "healthy"
  && driverPlan?.executesImmediately === false
  && recovered.includeUserOverlay === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.7",
  benchmark: "process-supervisor-recovery",
  degradedAfterCrash: degraded.status === "degraded",
  recoverActionPlanned: planned.status === "approval_required" && planned.executesImmediately === false,
  restartedAfterApproval: restarted.status === "restarted" && recovered.status === "healthy",
  supervisedChildren: recovered.children.length,
  driverCrashPlanned: driverPlan?.id === "restart-cua-driver-mcp" && driverPlan.executesImmediately === false,
  includeUserOverlay: recovered.includeUserOverlay,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;

function createFakeProcessFactory() {
  let nextPid = 5000;
  return {
    start() {
      const listeners = new Map();
      return {
        pid: nextPid++,
        killed: false,
        on(event, listener) {
          listeners.set(event, listener);
        },
        kill() {
          this.killed = true;
        },
        emitExit(code, signal) {
          listeners.get("exit")?.(code, signal);
        },
      };
    },
  };
}
