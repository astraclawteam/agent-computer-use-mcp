import { createCleanInstallDegradedProof, validateCleanInstallDegradedProof } from "./clean-install-degraded-proof.mjs";
import { runInstallCacheDoctor } from "./install-cache-doctor.mjs";

const health = {
  status: "ready",
  module: "agent-computer-use-mcp",
  includeUserOverlay: false,
};
const installCache = await runInstallCacheDoctor({
  platform: "win32",
  env: { LOCALAPPDATA: "C:\\Users\\clean\\AppData\\Local" },
  probes: {
    pathExists: async () => false,
    driverHealth: async () => ({ status: "unavailable", reason: "not-found" }),
    webView2Health: async () => ({ status: "unavailable", reason: "not-installed" }),
    ocrRuntimeHealth: async () => ({ status: "unavailable", reason: "module-not-found" }),
    permissionsHealth: async () => ({ status: "degraded", missing: ["accessibility"] }),
    signatureHealth: async () => ({ status: "skipped", reason: "asset-missing" }),
  },
});
const proof = createCleanInstallDegradedProof({ health, installCache });
const validation = validateCleanInstallDegradedProof(proof);

process.stdout.write(`${JSON.stringify({
  status: validation.status,
  phase: "7.7",
  benchmark: "clean-install-degraded-proof",
  cleanInstallStatus: proof.status,
  fastHealthStatus: proof.fastHealth.status,
  repairActionCount: proof.repairActionIds.length,
  catalogEntryCount: proof.repairCatalogEntryIds.length,
  repairActionIds: proof.repairActionIds,
  requiresApproval: proof.repairPlan.requiresApproval,
  violations: validation.violations,
  startsDesktopControl: validation.startsDesktopControl,
  includeUserOverlay: validation.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = validation.status === "passed" ? 0 : 1;
