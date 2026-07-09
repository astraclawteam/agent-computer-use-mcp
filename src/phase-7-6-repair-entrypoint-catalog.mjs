import { buildRepairEntrypointCatalog, validateRepairEntrypointCatalog } from "./repair-entrypoint-catalog.mjs";

const repairPlan = {
  mode: "plan-only",
  requiresApproval: true,
  actions: [
    { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
    { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
    { id: "install-ocr-runtime-onnxruntime-node", kind: "runtime", reason: "module-not-found", executesImmediately: false },
    { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
    { id: "install-webview2-runtime", kind: "system-runtime", reason: "not-installed", executesImmediately: false },
    { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
  ],
};

const catalog = buildRepairEntrypointCatalog({
  repairPlan,
  platform: "win32",
});
const validation = validateRepairEntrypointCatalog(catalog, {
  requiredEntryIds: repairPlan.actions.map((action) => action.id),
});
const implicitDownloadAllowed = catalog.entries.some((entry) => entry.networkPolicy === "implicit-download")
  || catalog.policy.implicitDownloadsAllowed === true;

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "7.6",
  benchmark: "repair-entrypoint-catalog",
  entryCount: catalog.entries.length,
  approvalRequired: catalog.entries.every((entry) => entry.approvalRequired === true),
  implicitDownloadAllowed,
  hostExecutors: Array.from(new Set(catalog.entries.map((entry) => entry.hostExecutor))),
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
