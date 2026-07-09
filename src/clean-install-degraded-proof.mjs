const DEFAULT_CLEAN_INSTALL_REPAIR_ACTIONS = [
  "install-cua-driver-windows-x64",
  "build-or-install-gateway-overlay-windows",
  "install-ocr-runtime-onnxruntime-node",
  "cache-ocr-model-pp-ocrv6-small",
  "install-webview2-runtime",
  "grant-accessibility-permission",
];

export function createCleanInstallDegradedProof(options = {}) {
  const health = options.health ?? {};
  const installCache = options.installCache ?? {};
  const repairPlan = installCache.repairPlan ?? { mode: "plan-only", requiresApproval: false, actions: [] };
  const repairCatalog = installCache.repairCatalog ?? { entries: [], policy: {} };
  const repairActionIds = (repairPlan.actions ?? []).map((action) => action.id);
  const repairCatalogEntryIds = (repairCatalog.entries ?? []).map((entry) => entry.id);
  const cleanInstallStatus = installCache.status === "healthy" ? "ready" : "degraded";

  return {
    phase: "7.7",
    status: cleanInstallStatus,
    mode: "clean-install-degraded-proof",
    fastHealth: {
      status: health.status ?? "unknown",
      module: health.module ?? "agent-computer-use-mcp",
      includeUserOverlay: health.includeUserOverlay === true,
    },
    installCache,
    repairPlan,
    repairCatalog,
    repairActionIds,
    repairCatalogEntryIds,
    requiredRepairActionIds: options.requiredRepairActionIds ?? DEFAULT_CLEAN_INSTALL_REPAIR_ACTIONS,
    policy: {
      cleanInstallMayBeDegraded: true,
      degradedMustBeActionable: true,
      repairsRemainPlanOnly: true,
      hostMustRequestApproval: true,
      noImplicitDownloads: true,
    },
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

export function validateCleanInstallDegradedProof(proof, options = {}) {
  const violations = [];
  const requiredRepairActionIds = options.requiredRepairActionIds ?? proof.requiredRepairActionIds ?? [];
  const repairActionIds = new Set(proof.repairActionIds ?? []);
  const catalogEntryIds = new Set(proof.repairCatalogEntryIds ?? []);

  if (proof.fastHealth?.status !== "ready") {
    violations.push({ code: "fast-health-not-ready", status: proof.fastHealth?.status ?? "missing" });
  }
  if (proof.status !== "degraded") {
    violations.push({ code: "clean-install-not-degraded", status: proof.status });
  }
  if (proof.repairPlan?.mode !== "plan-only") {
    violations.push({ code: "repair-plan-not-plan-only" });
  }
  if (proof.repairPlan?.requiresApproval !== true) {
    violations.push({ code: "repair-plan-not-approval-gated" });
  }

  for (const requiredId of requiredRepairActionIds) {
    if (!repairActionIds.has(requiredId)) {
      violations.push({ code: "repair-action-missing", id: requiredId });
      continue;
    }
    if (!catalogEntryIds.has(requiredId)) {
      violations.push({ code: "repair-catalog-missing-action", id: requiredId });
    }
  }

  for (const action of proof.repairPlan?.actions ?? []) {
    if (action.executesImmediately !== false) {
      violations.push({ code: "repair-action-executes-immediately", id: action.id });
    }
  }
  for (const entry of proof.repairCatalog?.entries ?? []) {
    if (entry.approvalRequired !== true) {
      violations.push({ code: "repair-entry-not-approval-gated", id: entry.id });
    }
    if (entry.executesImmediately !== false) {
      violations.push({ code: "repair-entry-executes-immediately", id: entry.id });
    }
    if (entry.startsDesktopControl !== false) {
      violations.push({ code: "repair-entry-starts-desktop-control", id: entry.id });
    }
    if (entry.includeUserOverlay !== false) {
      violations.push({ code: "repair-entry-includes-user-overlay", id: entry.id });
    }
  }
  if (proof.repairCatalog?.policy?.implicitDownloadsAllowed !== false) {
    violations.push({ code: "repair-catalog-allows-implicit-downloads" });
  }
  if (proof.startsDesktopControl !== false) {
    violations.push({ code: "clean-install-starts-desktop-control" });
  }
  if (proof.includeUserOverlay !== false) {
    violations.push({ code: "clean-install-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "7.7",
    violations,
    violationCount: violations.length,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}
