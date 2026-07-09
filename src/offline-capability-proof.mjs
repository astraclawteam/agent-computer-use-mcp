const REQUIRED_CAPABILITIES = [
  {
    id: "health",
    title: "Fast health",
    repairId: "prepare-offline-health",
  },
  {
    id: "overlay",
    title: "Gateway overlay",
    repairId: "prepare-offline-overlay",
  },
  {
    id: "semantic-capture",
    title: "Semantic capture",
    repairId: "prepare-offline-semantic-capture",
  },
  {
    id: "model-pack-ocr",
    title: "Configured model-pack OCR",
    repairId: "cache-configured-ocr-model-pack",
  },
];

export function createOfflineCapabilityProof(options = {}) {
  const capabilities = options.capabilities ?? {};
  const bundle = options.bundle ?? { status: "unknown" };
  const blockers = [];
  const repairEntryPoints = [];

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

  const proofCapabilities = REQUIRED_CAPABILITIES.map((required) => {
    const capability = normalizeCapability(required, capabilities[required.id]);
    const blockerReason = blockerReasonFor(capability);
    if (blockerReason) {
      blockers.push({
        id: required.id,
        reason: blockerReason,
        status: capability.status,
        source: capability.source,
      });
      repairEntryPoints.push(repairEntryPoint({
        id: required.repairId,
        title: `Prepare ${required.title}`,
        kind: required.id,
        reason: blockerReason,
      }));
    }
    return capability;
  });

  const ready = blockers.length === 0;
  return {
    phase: "7.3",
    status: ready ? "ready" : "blocked",
    mode: "offline-capability-proof",
    bundle: {
      status: bundle.status ?? "unknown",
      manifestId: bundle.manifestId ?? null,
    },
    capabilities: proofCapabilities,
    blockers,
    repairEntryPoints,
    networkRequired: false,
    networkPolicy: {
      forbidNetworkDuringProof: true,
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
    title: required.title,
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
