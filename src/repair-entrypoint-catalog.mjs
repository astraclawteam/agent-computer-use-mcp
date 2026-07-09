const ENTRYPOINTS = {
  driver: {
    component: "cua-driver",
    hostExecutor: "installer-cache",
    offlineBundleAssetId: "cua-driver-windows-x64",
    networkPolicy: "approval-gated",
    networkRequired: false,
  },
  "overlay-shell": {
    component: "gateway-overlay",
    hostExecutor: "installer-cache",
    offlineBundleAssetId: "gateway-overlay-windows",
    networkPolicy: "offline-only",
    networkRequired: false,
  },
  runtime: {
    component: "ocr-runtime",
    hostExecutor: "package-manager",
    offlineBundleAssetId: "ocr-runtime-onnxruntime-node",
    networkPolicy: "approval-gated",
    networkRequired: false,
  },
  "model-pack": {
    component: "ocr-model-pack",
    hostExecutor: "model-cache",
    offlineBundleAssetId: "ocr-model-pp-ocrv6-small",
    networkPolicy: "approval-gated",
    networkRequired: false,
  },
  "system-runtime": {
    component: "webview2-runtime",
    hostExecutor: "system-installer",
    networkPolicy: "approval-gated",
    networkRequired: false,
    externalInstaller: true,
  },
  permission: {
    component: "os-permission",
    hostExecutor: "system-settings",
    networkPolicy: "offline-only",
    networkRequired: false,
    opensSystemSettings: true,
    requiresUserGesture: true,
  },
  "os-feature": {
    component: "os-feature",
    hostExecutor: "system-settings",
    networkPolicy: "offline-only",
    networkRequired: false,
    requiresAdmin: true,
  },
};

export function buildRepairEntrypointCatalog(options = {}) {
  const repairPlan = options.repairPlan ?? { actions: [] };
  const actions = repairPlan.actions ?? [];
  const entries = actions.map((action, index) => buildEntrypoint(action, index));

  return {
    phase: "7.6",
    status: entries.length === 0 ? "not_needed" : "ready",
    mode: "repair-entrypoint-catalog",
    platform: options.platform ?? process.platform,
    entryCount: entries.length,
    entries,
    policy: {
      planOnlyUntilApproval: true,
      networkRequiresApproval: true,
      hostExecutesRepairs: true,
      implicitDownloadsAllowed: false,
    },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function validateRepairEntrypointCatalog(catalog, options = {}) {
  const violations = [];
  const entries = catalog.entries ?? [];
  const entryIds = new Set(entries.map((entry) => entry.id));
  for (const requiredId of options.requiredEntryIds ?? []) {
    if (!entryIds.has(requiredId)) {
      violations.push({ code: "entry-missing", id: requiredId });
    }
  }

  for (const entry of entries) {
    if (entry.approvalRequired !== true) {
      violations.push({ code: "entry-not-approval-gated", id: entry.id });
    }
    if (entry.executesImmediately !== false) {
      violations.push({ code: "entry-executes-immediately", id: entry.id });
    }
    if (entry.networkPolicy === "implicit-download") {
      violations.push({ code: "entry-allows-implicit-download", id: entry.id });
    }
    if (entry.startsDesktopControl !== false) {
      violations.push({ code: "entry-starts-desktop-control", id: entry.id });
    }
    if (entry.includeUserOverlay !== false) {
      violations.push({ code: "entry-includes-user-overlay", id: entry.id });
    }
  }

  if (catalog.policy?.implicitDownloadsAllowed !== false) {
    violations.push({ code: "catalog-allows-implicit-downloads" });
  }
  if (catalog.startsDesktopControl !== false) {
    violations.push({ code: "catalog-starts-desktop-control" });
  }
  if (catalog.includeUserOverlay !== false) {
    violations.push({ code: "catalog-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "7.6",
    violations,
    violationCount: violations.length,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function buildEntrypoint(action, index) {
  const template = ENTRYPOINTS[action.kind] ?? {
    component: action.kind ?? "repair",
    hostExecutor: "host-repair",
    networkPolicy: "approval-gated",
    networkRequired: false,
  };
  return {
    id: action.id,
    kind: action.kind ?? "repair",
    component: template.component,
    label: labelForAction(action),
    reason: action.reason ?? "repair-requested",
    order: index,
    target: action.target ?? null,
    missingFiles: action.missingFiles ?? [],
    hostExecutor: template.hostExecutor,
    offlineBundleAssetId: template.offlineBundleAssetId ?? null,
    networkPolicy: template.networkPolicy,
    networkRequired: template.networkRequired,
    externalInstaller: template.externalInstaller === true,
    requiresAdmin: template.requiresAdmin === true,
    requiresUserGesture: template.requiresUserGesture === true,
    opensSystemSettings: template.opensSystemSettings === true,
    approvalRequired: true,
    cancellable: true,
    executesImmediately: false,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function labelForAction(action) {
  if (action.id === "install-cua-driver-windows-x64") return "Install cua-driver for Windows";
  if (action.id === "build-or-install-gateway-overlay-windows") return "Install Gateway overlay shell";
  if (action.id === "install-ocr-runtime-onnxruntime-node") return "Install OCR runtime";
  if (action.id === "cache-ocr-model-pp-ocrv6-small") return "Cache PP-OCRv6 small model pack";
  if (action.id === "install-webview2-runtime") return "Install WebView2 runtime";
  if (action.id === "grant-accessibility-permission") return "Grant OS accessibility permission";
  if (action.kind === "os-feature") return "Enable required OS feature";
  return `Repair ${action.id}`;
}
