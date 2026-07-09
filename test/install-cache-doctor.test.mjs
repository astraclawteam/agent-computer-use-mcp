import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

import {
  buildRepairPlan,
  runInstallCacheDoctor,
} from "../src/install-cache-doctor.mjs";

test("install cache doctor reports all product assets healthy when present", async () => {
  const doctor = await runInstallCacheDoctor({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
    probes: {
      pathExists: async () => true,
      driverHealth: async () => ({ status: "healthy", version: "cua-driver 1.2.3" }),
      webView2Health: async () => ({ status: "healthy", version: "123.0.0" }),
      ocrRuntimeHealth: async () => ({ status: "healthy", runtime: "onnxruntime-node" }),
      permissionsHealth: async () => ({ status: "healthy" }),
      signatureHealth: async () => ({ status: "healthy" }),
    },
  });

  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.assets.length, 5);
  assert.deepEqual(doctor.assets.map((asset) => [asset.id, asset.status]), [
    ["cua-driver-windows-x64", "healthy"],
    ["gateway-overlay-windows", "healthy"],
    ["ocr-runtime-onnxruntime-node", "healthy"],
    ["ocr-model-pp-ocrv6-small", "healthy"],
    ["webview2-runtime", "healthy"],
  ]);
  assert.equal(doctor.permissions.status, "healthy");
  assert.deepEqual(doctor.repairPlan.actions, []);
});

test("install cache doctor reports degraded state and repair actions for missing optional assets", async () => {
  const missing = new Set([
    "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\cua-driver",
    "C:\\Users\\demo\\AppData\\Local\\Programs\\AgentComputerUse\\overlay",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small",
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

  assert.equal(doctor.status, "degraded");
  assert.equal(doctor.assets.find((asset) => asset.id === "cua-driver-windows-x64").status, "missing");
  assert.equal(doctor.assets.find((asset) => asset.id === "ocr-model-pp-ocrv6-small").status, "missing");
  assert.equal(doctor.permissions.status, "degraded");
  assert.deepEqual(doctor.repairPlan.actions.map((action) => action.id), [
    "install-cua-driver-windows-x64",
    "build-or-install-gateway-overlay-windows",
    "cache-ocr-model-pp-ocrv6-small",
    "install-webview2-runtime",
    "grant-accessibility-permission",
  ]);
  assert.equal(doctor.repairPlan.requiresApproval, true);
  assert.equal(doctor.includeUserOverlay, false);
});

test("repair plan never performs downloads or installs implicitly", () => {
  const plan = buildRepairPlan({
    assets: [
      { id: "cua-driver-windows-x64", status: "missing", repair: "install-cua-driver" },
      { id: "ocr-model-pp-ocrv6-small", status: "missing", repair: "cache-model-pack" },
    ],
    webView2: { status: "unavailable", repair: "install-webview2" },
    permissions: { status: "degraded", repair: "grant-permissions" },
  });

  assert.equal(plan.mode, "plan-only");
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.actions.every((action) => action.executesImmediately === false), true);
});

test("install cache doctor script emits JSON without starting desktop control", async () => {
  const result = await runNode(["scripts/install-cache-doctor.mjs", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(["healthy", "degraded", "unavailable"].includes(report.status), true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(Array.isArray(report.repairPlan.actions), true);
});

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
