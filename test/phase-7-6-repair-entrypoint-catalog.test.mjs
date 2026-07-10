import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("repair entrypoint catalog describes product-safe repair UX for every setup action", async () => {
  const {
    buildRepairEntrypointCatalog,
    validateRepairEntrypointCatalog,
  } = await import("../src/repair-entrypoint-catalog.mjs");

  const catalog = buildRepairEntrypointCatalog({
    repairPlan: sampleRepairPlan(),
    platform: "win32",
  });
  const validation = validateRepairEntrypointCatalog(catalog, {
    requiredEntryIds: sampleRepairPlan().actions.map((action) => action.id),
  });

  assert.equal(catalog.phase, "7.6");
  assert.equal(catalog.mode, "repair-entrypoint-catalog");
  assert.equal(catalog.status, "ready");
  assert.equal(catalog.platform, "win32");
  assert.deepEqual(catalog.entries.map((entry) => entry.id), [
    "install-cua-driver-windows-x64",
    "build-or-install-gateway-overlay-windows",
    "install-ocr-runtime-onnxruntime-node",
    "cache-ocr-model-pp-ocrv6-small",
    "install-webview2-runtime",
    "grant-accessibility-permission",
    "enable-ui-automation-os-feature",
  ]);
  assert.equal(catalog.entries.every((entry) => entry.approvalRequired === true), true);
  assert.equal(catalog.entries.every((entry) => entry.executesImmediately === false), true);
  assert.equal(catalog.entries.every((entry) => entry.startsDesktopControl === false), true);
  assert.equal(catalog.entries.every((entry) => entry.includeUserOverlay === false), true);

  const driver = catalog.entries.find((entry) => entry.id === "install-cua-driver-windows-x64");
  assert.equal(driver.component, "cua-driver");
  assert.equal(driver.hostExecutor, "installer-cache");
  assert.equal(driver.offlineBundleAssetId, "cua-driver-windows-x64");
  assert.equal(driver.networkPolicy, "approval-gated");

  const model = catalog.entries.find((entry) => entry.id === "cache-ocr-model-pp-ocrv6-small");
  assert.equal(model.component, "ocr-model-pack");
  assert.equal(model.offlineBundleAssetId, "ocr-model-pp-ocrv6-small");
  assert.equal(model.networkPolicy, "approval-gated");

  const webview = catalog.entries.find((entry) => entry.id === "install-webview2-runtime");
  assert.equal(webview.component, "webview2-runtime");
  assert.equal(webview.externalInstaller, true);
  assert.equal(webview.hostExecutor, "system-installer");

  const permission = catalog.entries.find((entry) => entry.id === "grant-accessibility-permission");
  assert.equal(permission.component, "os-permission");
  assert.equal(permission.requiresUserGesture, true);
  assert.equal(permission.opensSystemSettings, true);
  assert.equal(permission.networkRequired, false);

  const osFeature = catalog.entries.find((entry) => entry.id === "enable-ui-automation-os-feature");
  assert.equal(osFeature.component, "os-feature");
  assert.equal(osFeature.requiresAdmin, true);
  assert.equal(osFeature.networkRequired, false);

  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("repair entrypoint catalog fails closed for missing entries or implicit execution", async () => {
  const {
    buildRepairEntrypointCatalog,
    validateRepairEntrypointCatalog,
  } = await import("../src/repair-entrypoint-catalog.mjs");

  const catalog = buildRepairEntrypointCatalog({
    repairPlan: {
      mode: "plan-only",
      requiresApproval: true,
      actions: [
        { id: "install-cua-driver-windows-x64", kind: "driver", executesImmediately: false },
      ],
    },
  });
  catalog.entries[0].executesImmediately = true;
  catalog.entries[0].approvalRequired = false;
  catalog.entries[0].networkPolicy = "implicit-download";

  const validation = validateRepairEntrypointCatalog(catalog, {
    requiredEntryIds: ["install-cua-driver-windows-x64", "cache-ocr-model-pp-ocrv6-small"],
  });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "entry-missing",
    "entry-not-approval-gated",
    "entry-executes-immediately",
    "entry-allows-implicit-download",
  ]);
});

test("install cache doctor exposes repair entrypoints without desktop control", async () => {
  const { runInstallCacheDoctor } = await import("../src/install-cache-doctor.mjs");
  const missing = new Set([
    "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\cua-driver",
    "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\overlay",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\PP-OCRv6_det_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\PP-OCRv6_rec_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\ppocrv6_dict.txt",
  ]);

  const doctor = await runInstallCacheDoctor({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
    probes: {
      pathExists: async (path) => !missing.has(path),
      driverHealth: async () => ({ status: "unavailable", reason: "not-found" }),
      webView2Health: async () => ({ status: "unavailable", reason: "not-installed" }),
      ocrRuntimeHealth: async () => ({ status: "healthy", runtime: "onnxruntime-node" }),
      permissionsHealth: async () => ({ status: "degraded", missing: ["accessibility"] }),
      signatureHealth: async () => ({ status: "skipped", reason: "asset-missing" }),
    },
  });

  assert.equal(doctor.repairCatalog.phase, "7.6");
  assert.deepEqual(
    doctor.repairCatalog.entries.map((entry) => entry.id),
    doctor.repairPlan.actions.map((action) => action.id),
  );
  assert.equal(doctor.repairCatalog.entries.every((entry) => entry.approvalRequired === true), true);
  assert.equal(doctor.repairCatalog.includeUserOverlay, false);
  assert.equal(doctor.repairCatalog.startsDesktopControl, false);
});

test("Phase 7.6 has an executable repair entrypoint catalog smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.6"], "node src/phase-7-6-repair-entrypoint-catalog.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.6"], "repair-entrypoint-catalog");

  const result = await runNode(["src/phase-7-6-repair-entrypoint-catalog.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.6");
  assert.equal(report.benchmark, "repair-entrypoint-catalog");
  assert.equal(report.entryCount, 6);
  assert.equal(report.approvalRequired, true);
  assert.equal(report.implicitDownloadAllowed, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function sampleRepairPlan() {
  return {
    mode: "plan-only",
    requiresApproval: true,
    actions: [
      { id: "install-cua-driver-windows-x64", kind: "driver", reason: "not-found", executesImmediately: false },
      { id: "build-or-install-gateway-overlay-windows", kind: "overlay-shell", reason: "missing", executesImmediately: false },
      { id: "install-ocr-runtime-onnxruntime-node", kind: "runtime", reason: "module-not-found", executesImmediately: false },
      { id: "cache-ocr-model-pp-ocrv6-small", kind: "model-pack", reason: "missing:det,rec", executesImmediately: false },
      { id: "install-webview2-runtime", kind: "system-runtime", reason: "not-installed", executesImmediately: false },
      { id: "grant-accessibility-permission", kind: "permission", reason: "accessibility", executesImmediately: false },
      { id: "enable-ui-automation-os-feature", kind: "os-feature", reason: "disabled", executesImmediately: false },
    ],
  };
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
