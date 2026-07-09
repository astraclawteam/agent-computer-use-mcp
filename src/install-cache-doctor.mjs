import { access } from "node:fs/promises";
import { buildOfflineAssetManifest, getInstallLayout } from "./package-foundation.mjs";
import { checkCuaDriverHealth } from "./driver-health.mjs";
import { checkOcrModelPackHealth } from "./ocr-model-pack.mjs";
import { buildRepairEntrypointCatalog } from "./repair-entrypoint-catalog.mjs";

export async function runInstallCacheDoctor(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const layout = getInstallLayout({ platform, env });
  const manifest = buildOfflineAssetManifest({ packageVersion: options.packageVersion });
  const probes = {
    pathExists,
    driverHealth: defaultDriverHealth,
    webView2Health: defaultWebView2Health,
    ocrRuntimeHealth: defaultOcrRuntimeHealth,
    ocrModelPackHealth: defaultOcrModelPackHealth,
    permissionsHealth: defaultPermissionsHealth,
    signatureHealth: defaultSignatureHealth,
    ...options.probes,
  };

  const driverHealth = await probes.driverHealth({ env, layout });
  const overlayPath = layout.overlayRoot;
  const overlayExists = await probes.pathExists(overlayPath);
  const ocrRuntimeHealth = await probes.ocrRuntimeHealth({ env, layout });
  const ocrModelPackHealth = await probes.ocrModelPackHealth({ env, layout, probes });
  const webView2 = await probes.webView2Health({ env, layout, platform });
  const permissions = await probes.permissionsHealth({ env, layout });
  const overlaySignature = await probes.signatureHealth({ id: "gateway-overlay-windows", path: overlayPath });
  const driverSignature = await probes.signatureHealth({ id: "cua-driver-windows-x64", path: layout.driverRoot });

  const assets = [
    {
      id: "cua-driver-windows-x64",
      kind: "driver",
      path: layout.driverRoot,
      status: driverHealth.status === "healthy" ? "healthy" : "missing",
      health: driverHealth,
      signature: driverSignature,
      repair: "install-cua-driver",
    },
    {
      id: "gateway-overlay-windows",
      kind: "overlay-shell",
      path: overlayPath,
      status: overlayExists ? "healthy" : "missing",
      signature: overlaySignature,
      repair: "build-or-install-overlay",
    },
    {
      id: "ocr-runtime-onnxruntime-node",
      kind: "runtime",
      path: "package/node_modules/onnxruntime-node",
      status: ocrRuntimeHealth.status === "healthy" ? "healthy" : "missing",
      health: ocrRuntimeHealth,
      repair: "install-node-dependencies",
    },
    {
      id: "ocr-model-pp-ocrv6-small",
      kind: "model-pack",
      path: ocrModelPackHealth.root,
      status: ocrModelPackHealth.status === "healthy" ? "healthy" : "missing",
      health: ocrModelPackHealth,
      repair: "cache-model-pack",
    },
    {
      id: "webview2-runtime",
      kind: "system-runtime",
      path: "system",
      status: webView2.status === "healthy" ? "healthy" : "missing",
      health: webView2,
      repair: "install-webview2",
    },
  ];

  const repairPlan = buildRepairPlan({ assets, webView2, permissions });
  const repairCatalog = buildRepairEntrypointCatalog({ repairPlan, platform });
  const status = deriveDoctorStatus({ assets, permissions });

  return {
    status,
    platform,
    layout,
    manifest,
    assets,
    permissions,
    repairPlan,
    repairCatalog,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function buildRepairPlan({ assets = [], webView2 = {}, permissions = {} } = {}) {
  const actions = [];
  for (const asset of assets) {
    if (asset.status === "healthy") continue;
    const action = repairActionForAsset(asset);
    if (action) actions.push(action);
  }

  if (webView2.status && webView2.status !== "healthy" && !actions.some((action) => action.id === "install-webview2-runtime")) {
    actions.push({
      id: "install-webview2-runtime",
      kind: "system-runtime",
      reason: webView2.reason ?? "missing",
      executesImmediately: false,
    });
  }

  if (permissions.status && permissions.status !== "healthy") {
    actions.push({
      id: "grant-accessibility-permission",
      kind: "permission",
      reason: permissions.missing?.join(",") ?? permissions.reason ?? "degraded",
      executesImmediately: false,
    });
  }

  return {
    mode: "plan-only",
    requiresApproval: actions.length > 0,
    actions,
  };
}

function repairActionForAsset(asset) {
  if (asset.id === "cua-driver-windows-x64") {
    return {
      id: "install-cua-driver-windows-x64",
      kind: "driver",
      target: asset.path,
      reason: asset.health?.reason ?? "missing",
      executesImmediately: false,
    };
  }
  if (asset.id === "gateway-overlay-windows") {
    return {
      id: "build-or-install-gateway-overlay-windows",
      kind: "overlay-shell",
      target: asset.path,
      reason: asset.signature?.reason ?? "missing",
      executesImmediately: false,
    };
  }
  if (asset.id === "ocr-runtime-onnxruntime-node") {
    return {
      id: "install-ocr-runtime-onnxruntime-node",
      kind: "runtime",
      target: asset.path,
      reason: asset.health?.reason ?? "missing",
      executesImmediately: false,
    };
  }
  if (asset.id === "ocr-model-pp-ocrv6-small") {
    return {
      id: "cache-ocr-model-pp-ocrv6-small",
      kind: "model-pack",
      target: asset.path,
      reason: asset.health?.missingFiles?.length
        ? `missing:${asset.health.missingFiles.map((file) => file.role).join(",")}`
        : "missing",
      missingFiles: asset.health?.missingFiles?.map((file) => ({
        role: file.role,
        path: file.path,
      })) ?? [],
      executesImmediately: false,
    };
  }
  if (asset.id === "webview2-runtime") {
    return {
      id: "install-webview2-runtime",
      kind: "system-runtime",
      reason: asset.health?.reason ?? "missing",
      executesImmediately: false,
    };
  }
  return null;
}

function deriveDoctorStatus({ assets, permissions }) {
  if (assets.some((asset) => asset.status === "unavailable") || permissions.status === "unavailable") {
    return "unavailable";
  }
  if (assets.some((asset) => asset.status !== "healthy") || permissions.status !== "healthy") {
    return "degraded";
  }
  return "healthy";
}

async function defaultDriverHealth({ env }) {
  return checkCuaDriverHealth({ env });
}

async function defaultWebView2Health({ platform = process.platform } = {}) {
  if (platform !== "win32") return { status: "healthy", reason: "not-required" };
  return { status: "degraded", reason: "not-probed" };
}

async function defaultOcrRuntimeHealth() {
  try {
    await import("onnxruntime-node");
    return { status: "healthy", runtime: "onnxruntime-node" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "module-not-found",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function defaultOcrModelPackHealth({ layout, probes }) {
  return checkOcrModelPackHealth({
    modelRoot: layout.modelRoot,
    probes,
  });
}

async function defaultPermissionsHealth() {
  return { status: "healthy", reason: "not-required-for-doctor" };
}

async function defaultSignatureHealth() {
  return { status: "skipped", reason: "not-implemented" };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
