import { createFirstRunReadinessPlan } from "./first-run-readiness.mjs";

const missingDoctor = {
  status: "degraded",
  repairPlan: {
    mode: "plan-only",
    requiresApproval: true,
    actions: [
      { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
      { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
      { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec,cls", executesImmediately: false },
      { id: "install-webview2-runtime", kind: "system-runtime", reason: "not-installed", executesImmediately: false },
      { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
    ],
  },
};
const readyDoctor = {
  status: "healthy",
  repairPlan: { mode: "plan-only", requiresApproval: false, actions: [] },
};

const firstRun = createFirstRunReadinessPlan({ doctor: missingDoctor });
const ready = createFirstRunReadinessPlan({ doctor: readyDoctor });
const passed = firstRun.status === "needs_setup"
  && ready.status === "ready"
  && firstRun.repairEntryPoints.length === 5
  && firstRun.progress.at(-1)?.state === "blocked"
  && ready.progress.at(-1)?.state === "complete"
  && firstRun.networkPolicy.downloadOnFirstEnable === false
  && firstRun.executesImmediately === false
  && firstRun.startsDesktopControl === false
  && firstRun.includeUserOverlay === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "7.0",
  benchmark: "first-run-readiness",
  firstRunStatus: firstRun.status,
  readyStatus: ready.status,
  downloadOnFirstEnable: firstRun.networkPolicy.downloadOnFirstEnable,
  repairEntryPointCount: firstRun.repairEntryPoints.length,
  progressStates: firstRun.progress.map((step) => [step.id, step.state]),
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
