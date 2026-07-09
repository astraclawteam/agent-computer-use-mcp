const EXPECTED_ASSETS = [
  { id: "cua-driver-windows-x64", kind: "driver", offlineRequired: true },
  { id: "gateway-overlay-windows", kind: "overlay-shell", offlineRequired: true },
  { id: "ocr-runtime-onnxruntime-node", kind: "runtime", offlineRequired: true },
  { id: "ocr-model-pp-ocrv6-small", kind: "model-pack", offlineRequired: false },
  { id: "webview2-runtime", kind: "system-runtime", offlineRequired: false },
];

export function createOfflineBundleReadinessReport(options = {}) {
  const manifest = options.manifest ?? {};
  const expectedAssets = options.expectedAssets ?? EXPECTED_ASSETS;
  const assetsById = new Map((manifest.assets ?? []).map((asset) => [asset.id, asset]));
  const repairEntryPoints = [];
  const requiredAssets = [];
  const optionalAssets = [];

  for (const expected of expectedAssets) {
    const actual = assetsById.get(expected.id);
    const result = validateBundleAsset({ expected, actual });
    if (result.repairEntryPoint) repairEntryPoints.push(result.repairEntryPoint);
    const bucket = expected.offlineRequired ? requiredAssets : optionalAssets;
    bucket.push(result.asset);
  }

  const requiredReady = requiredAssets.every((asset) => asset.status === "ready");
  const optionalValid = optionalAssets.every((asset) => asset.status === "ready" || asset.status === "not-bundled");
  const ready = requiredReady && optionalValid && repairEntryPoints.length === 0;

  return {
    phase: "7.1",
    status: ready ? "ready" : "needs_setup",
    mode: "offline-bundle-readiness",
    packageName: manifest.packageName ?? "agent-computer-use-mcp",
    packageVersion: options.packageVersion ?? manifest.packageVersion ?? "unknown",
    manifestSchemaVersion: manifest.schemaVersion ?? "unknown",
    requiredAssets,
    optionalAssets,
    repairEntryPoints,
    progress: [
      { id: "manifest", label: "Read offline asset cache manifest", state: "complete" },
      ...repairEntryPoints.map((entry) => ({
        id: entry.id,
        label: entry.title,
        state: "waiting-for-approval",
      })),
      { id: "ready", label: "Enable offline Computer Use", state: ready ? "complete" : "blocked" },
    ],
    networkPolicy: {
      downloadOnFirstEnable: false,
      longOperationsRequireProgress: true,
      bundleMustBePreparedBeforeEnable: true,
    },
    downloadOnFirstEnable: false,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
}

function validateBundleAsset({ expected, actual }) {
  if (!actual) {
    const status = expected.offlineRequired ? "missing" : "not-bundled";
    return {
      asset: assetResult({ expected, actual: null, status, reason: expected.offlineRequired ? "missing-required-asset" : "optional-not-bundled" }),
      repairEntryPoint: expected.offlineRequired
        ? repairEntryPoint({
            id: `add-${expected.id}-to-offline-bundle`,
            title: `Add ${expected.id} to offline bundle`,
            kind: expected.kind,
            reason: "missing-required-asset",
          })
        : null,
    };
  }

  const metadataProblem = validateAssetMetadata(actual);
  if (metadataProblem) {
    const prefix = expected.kind === "model-pack" ? "prepare" : "verify";
    const suffix = expected.kind === "model-pack" ? "cache-entry" : "bundle-metadata";
    return {
      asset: assetResult({ expected, actual, status: "invalid", reason: metadataProblem }),
      repairEntryPoint: repairEntryPoint({
        id: `${prefix}-${expected.id}-${suffix}`,
        title: `${titleCase(prefix)} ${expected.id} ${suffix.replace(/-/g, " ")}`,
        kind: expected.kind,
        reason: metadataProblem,
      }),
    };
  }

  return {
    asset: assetResult({ expected, actual, status: "ready", reason: "complete" }),
    repairEntryPoint: null,
  };
}

function validateAssetMetadata(asset) {
  if (!asset.cacheKey || typeof asset.cacheKey !== "string") return "missing-cache-key";
  if (!asset.sha256 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) return "missing-sha256";
  if (!Number.isFinite(asset.sizeBytes) || asset.sizeBytes <= 0) return "missing-size";
  return null;
}

function assetResult({ expected, actual, status, reason }) {
  return {
    id: expected.id,
    kind: expected.kind,
    offlineRequired: expected.offlineRequired,
    status,
    reason,
    cacheKey: actual?.cacheKey ?? null,
    targetRoot: actual?.targetRoot ?? null,
    version: actual?.version ?? null,
  };
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

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
