import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("clean install degraded proof turns empty Windows roots into exact repair actions", async () => {
  const {
    createCleanInstallDegradedProof,
    validateCleanInstallDegradedProof,
  } = await import("../src/clean-install-degraded-proof.mjs");

  const doctor = await cleanWindowsDoctor();
  const proof = createCleanInstallDegradedProof({
    health: cleanFastHealth(),
    installCache: doctor,
  });
  const validation = validateCleanInstallDegradedProof(proof);

  assert.equal(proof.phase, "7.7");
  assert.equal(proof.mode, "clean-install-degraded-proof");
  assert.equal(proof.status, "degraded");
  assert.equal(proof.fastHealth.status, "ready");
  assert.equal(proof.installCache.status, "degraded");
  assert.deepEqual(proof.repairActionIds, [
    "install-cua-driver-windows-x64",
    "build-or-install-gateway-overlay-windows",
    "install-ocr-runtime-onnxruntime-node",
    "cache-ocr-model-pp-ocrv6-small",
    "install-webview2-runtime",
    "grant-accessibility-permission",
  ]);
  assert.deepEqual(proof.repairCatalogEntryIds, proof.repairActionIds);
  assert.equal(proof.repairPlan.mode, "plan-only");
  assert.equal(proof.repairPlan.requiresApproval, true);
  assert.equal(proof.repairCatalog.policy.planOnlyUntilApproval, true);
  assert.equal(proof.repairCatalog.policy.implicitDownloadsAllowed, false);
  assert.equal(proof.repairCatalog.entries.every((entry) => entry.executesImmediately === false), true);
  assert.equal(proof.repairCatalog.entries.every((entry) => entry.approvalRequired === true), true);
  assert.equal(proof.startsDesktopControl, false);
  assert.equal(proof.includeUserOverlay, false);
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("clean install degraded proof fails closed for missing repair catalog coverage", async () => {
  const {
    createCleanInstallDegradedProof,
    validateCleanInstallDegradedProof,
  } = await import("../src/clean-install-degraded-proof.mjs");

  const proof = createCleanInstallDegradedProof({
    health: cleanFastHealth(),
    installCache: {
      status: "degraded",
      repairPlan: {
        mode: "plan-only",
        requiresApproval: true,
        actions: [
          { id: "install-cua-driver-windows-x64", kind: "driver", executesImmediately: false },
        ],
      },
      repairCatalog: {
        phase: "7.6",
        entries: [],
        policy: { implicitDownloadsAllowed: false, planOnlyUntilApproval: true },
      },
      startsDesktopControl: false,
      includeUserOverlay: false,
    },
  });

  const validation = validateCleanInstallDegradedProof(proof, {
    requiredRepairActionIds: ["install-cua-driver-windows-x64"],
  });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "repair-catalog-missing-action",
  ]);
});

test("Phase 7.7 has an executable clean install degraded smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:7.7"], "node src/phase-7-7-clean-install-degraded-proof.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["7.7"], "clean-install-degraded-proof");

  const result = await runNode(["src/phase-7-7-clean-install-degraded-proof.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "7.7");
  assert.equal(report.benchmark, "clean-install-degraded-proof");
  assert.equal(report.cleanInstallStatus, "degraded");
  assert.equal(report.fastHealthStatus, "ready");
  assert.equal(report.repairActionCount, 6);
  assert.equal(report.catalogEntryCount, 6);
  assert.equal(report.requiresApproval, true);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function cleanFastHealth() {
  return {
    status: "ready",
    module: "agent-computer-use-mcp",
    phases: { "7.7": "clean-install-degraded-proof" },
    includeUserOverlay: false,
  };
}

function cleanWindowsDoctor() {
  return import("../src/install-cache-doctor.mjs").then(({ runInstallCacheDoctor }) => runInstallCacheDoctor({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\clean\\AppData\\Local" },
    probes: {
      pathExists: async () => false,
      driverHealth: async () => ({ status: "unavailable", reason: "not-found" }),
      webView2Health: async () => ({ status: "unavailable", reason: "not-installed" }),
      ocrRuntimeHealth: async () => ({ status: "unavailable", reason: "module-not-found" }),
      permissionsHealth: async () => ({ status: "degraded", missing: ["accessibility"] }),
      signatureHealth: async () => ({ status: "skipped", reason: "asset-missing" }),
    },
  }));
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
