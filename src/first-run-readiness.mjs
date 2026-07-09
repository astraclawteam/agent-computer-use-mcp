const REPAIR_TITLES = {
  "install-cua-driver-windows-x64": "Install cached cua-driver",
  "build-or-install-gateway-overlay-windows": "Install signed Gateway overlay",
  "install-ocr-runtime-onnxruntime-node": "Install OCR runtime package",
  "cache-ocr-model-pp-ocrv6-small": "Cache PP-OCRv6 small model pack",
  "install-webview2-runtime": "Install WebView2 runtime",
  "grant-accessibility-permission": "Grant OS accessibility permission",
};

export function createFirstRunReadinessPlan(options = {}) {
  const doctor = options.doctor ?? {};
  const actions = doctor.repairPlan?.actions ?? [];
  const repairEntryPoints = actions.map((action) => ({
    id: action.id,
    title: REPAIR_TITLES[action.id] ?? titleFromAction(action),
    kind: action.kind ?? "repair",
    reason: action.reason ?? "not-ready",
    requiresApproval: true,
    executesImmediately: false,
    target: action.target ?? null,
    missingFiles: action.missingFiles ?? [],
  }));
  const ready = doctor.status === "healthy" && repairEntryPoints.length === 0;
  const progress = [
    {
      id: "doctor",
      label: "Run first-run doctor",
      state: "complete",
    },
    ...repairEntryPoints.map((entry) => ({
      id: entry.id,
      label: entry.title,
      state: "waiting-for-approval",
    })),
    {
      id: "ready",
      label: "Enable Computer Use",
      state: ready ? "complete" : "blocked",
    },
  ];

  return {
    phase: "7.0",
    status: ready ? "ready" : "needs_setup",
    mode: "first-run",
    doctorStatus: doctor.status ?? "unknown",
    repairEntryPoints,
    progress,
    nextAction: ready
      ? "enable computer use"
      : "request user approval for listed repair entry points",
    networkPolicy: {
      downloadOnFirstEnable: false,
      longOperationsRequireProgress: true,
      timeoutPolicy: "host-controlled",
    },
    offlinePolicy: {
      canRunOfflineHealth: true,
      canRunOverlayWhenCached: true,
      canRunConfiguredModelPackOcr: true,
      bundlePolicy: "use offline bundle or install cache before first enable",
    },
    executesImmediately: false,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function titleFromAction(action) {
  const value = String(action.id ?? action.kind ?? "repair action");
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
