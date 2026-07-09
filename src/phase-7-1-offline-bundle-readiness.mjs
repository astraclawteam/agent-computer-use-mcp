import { createOfflineBundleReadinessReport } from "./offline-bundle-readiness.mjs";

const readyManifest = {
  schemaVersion: 2,
  packageName: "agent-computer-use-mcp",
  packageVersion: "0.0.1",
  generatedAt: "2026-07-10T00:00:00.000Z",
  assets: [
    asset("cua-driver-windows-x64", "driver", true),
    asset("gateway-overlay-windows", "overlay-shell", true),
    asset("ocr-runtime-onnxruntime-node", "runtime", true),
    asset("ocr-model-pp-ocrv6-small", "model-pack", false),
    asset("webview2-runtime", "system-runtime", false),
  ],
};
const missingManifest = {
  ...readyManifest,
  assets: readyManifest.assets
    .filter((item) => item.id !== "gateway-overlay-windows")
    .map((item) => item.id === "cua-driver-windows-x64" ? { ...item, sha256: "" } : item),
};

const ready = createOfflineBundleReadinessReport({ manifest: readyManifest, packageVersion: "0.0.1" });
const missing = createOfflineBundleReadinessReport({ manifest: missingManifest, packageVersion: "0.0.1" });
const passed = ready.status === "ready"
  && missing.status === "needs_setup"
  && ready.downloadOnFirstEnable === false
  && ready.startsDesktopControl === false
  && ready.includeUserOverlay === false
  && missing.repairEntryPoints.map((entry) => entry.id).join(",") === [
    "verify-cua-driver-windows-x64-bundle-metadata",
    "add-gateway-overlay-windows-to-offline-bundle",
  ].join(",");

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "7.1",
  benchmark: "offline-bundle-readiness",
  readyStatus: ready.status,
  missingStatus: missing.status,
  downloadOnFirstEnable: ready.downloadOnFirstEnable,
  requiredAssetCount: ready.requiredAssets.length,
  optionalAssetCount: ready.optionalAssets.length,
  repairEntryPointIds: missing.repairEntryPoints.map((entry) => entry.id),
  includeUserOverlay: ready.includeUserOverlay,
  startsDesktopControl: ready.startsDesktopControl,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

function asset(id, kind, offlineRequired) {
  return {
    id,
    kind,
    platform: id.includes("windows") || id.includes("webview2") ? "win32" : "all",
    offlineRequired,
    acquisition: offlineRequired ? "offline-bundle" : "offline-bundle-or-system",
    targetRoot: id === "ocr-model-pp-ocrv6-small" ? "modelRoot/pp-ocrv6-small" : `cacheRoot/${id}`,
    cacheKey: `${id}@0.0.1`,
    version: "0.0.1",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  };
}
