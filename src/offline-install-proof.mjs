const INSTALL_ROOTS = [
  "dataRoot",
  "cacheRoot",
  "driverRoot",
  "overlayRoot",
  "runtimeRoot",
  "modelRoot",
];

const REQUIRED_CAPABILITIES = [
  { id: "health", repairId: "prepare-offline-health" },
  { id: "overlay", repairId: "prepare-offline-overlay" },
  { id: "semantic-capture", repairId: "prepare-offline-semantic-capture" },
  { id: "model-pack-ocr", repairId: "cache-configured-ocr-model-pack" },
];

export function createOfflineInstallProof(options = {}) {
  const installLayout = options.installLayout ?? {};
  const bundle = options.bundle ?? { status: "unknown" };
  const capabilities = options.capabilities ?? {};
  const blockers = [];
  const repairEntryPoints = [];

  const installRoots = INSTALL_ROOTS.map((id) => {
    const path = installLayout[id] ?? "";
    const status = path ? "ready" : "missing";
    if (status !== "ready") {
      blockers.push({ id, reason: "install-root-missing" });
      repairEntryPoints.push(repairEntryPoint({
        id: `prepare-${id}`,
        title: `Prepare ${id}`,
        kind: "install-root",
        reason: "install-root-missing",
      }));
    }
    return { id, path, status };
  });

  const proofs = [];
  if (bundle.status !== "ready") {
    blockers.push({
      id: "offline-bundle",
      reason: "bundle-not-ready",
      status: bundle.status ?? "unknown",
    });
    repairEntryPoints.push(repairEntryPoint({
      id: "prepare-offline-bundle",
      title: "Prepare offline bundle",
      kind: "offline-bundle",
      reason: "bundle-not-ready",
    }));
  }
  proofs.push({
    id: "offline-bundle",
    status: bundle.status ?? "unknown",
    manifestId: bundle.manifestId ?? null,
  });

  for (const required of REQUIRED_CAPABILITIES) {
    const capability = normalizeCapability(required, capabilities[required.id]);
    const reason = blockerReasonFor(capability);
    if (reason) {
      blockers.push({
        id: required.id,
        reason,
        status: capability.status,
        source: capability.source,
      });
      repairEntryPoints.push(repairEntryPoint({
        id: required.repairId,
        title: `Prepare ${capability.title}`,
        kind: required.id,
        reason,
      }));
    }
    proofs.push(capability);
  }

  const ready = blockers.length === 0;
  return {
    phase: "7.4",
    status: ready ? "ready" : "blocked",
    mode: "offline-install-proof",
    installRoots,
    proofs,
    blockers,
    repairEntryPoints,
    networkRequired: false,
    networkPolicy: {
      forbidNetworkDuringInstallProof: true,
      downloadOnFirstEnable: false,
      requirePreparedBundle: true,
    },
    downloadOnFirstEnable: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function normalizeCapability(required, capability = {}) {
  return {
    id: required.id,
    title: titleForCapability(required.id),
    status: capability.status ?? "missing",
    source: capability.source ?? "unknown",
    modelPackId: capability.modelPackId ?? null,
    networkRequired: capability.networkRequired === true,
    includeUserOverlay: capability.includeUserOverlay === true,
  };
}

function blockerReasonFor(capability) {
  if (capability.networkRequired) return "network-required";
  if (capability.includeUserOverlay) return "overlay-in-observation";
  if (capability.status !== "ready") return "capability-not-ready";
  return null;
}

function repairEntryPoint({ id, title, kind, reason }) {
  return {
    id,
    title,
    kind,
    reason,
    requiresApproval: true,
    executesImmediately: false,
  };
}

function titleForCapability(id) {
  return {
    health: "Fast health",
    overlay: "Gateway overlay",
    "semantic-capture": "Semantic capture",
    "model-pack-ocr": "Configured model-pack OCR",
  }[id] ?? id;
}
