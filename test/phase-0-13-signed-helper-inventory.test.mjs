import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("signed helper inventory maps signing policy to required release artifacts", async () => {
  const {
    buildSignedHelperInventory,
    validateSignedHelperInventory,
  } = await import("../src/signed-helper-inventory.mjs");

  const inventory = buildSignedHelperInventory({
    releaseArtifacts: [
      signedHelper("gateway-overlay-windows"),
      signedHelper("cua-driver-windows-x64"),
    ],
  });
  const validation = validateSignedHelperInventory(inventory);

  assert.equal(inventory.phase, "0.13");
  assert.equal(inventory.status, "passed");
  assert.deepEqual(inventory.requiredHelpers.map((helper) => helper.id), [
    "gateway-overlay-windows",
    "cua-driver-windows-x64",
  ]);
  assert.deepEqual(inventory.reservedHelpers.map((helper) => helper.id), [
    "future-native-sidecars",
  ]);
  assert.equal(inventory.signingPolicyWindowsHelperCount, 3);
  assert.equal(inventory.signedRequiredHelperCount, 2);
  assert.equal(inventory.timestampedRequiredHelperCount, 2);
  assert.equal(inventory.unsignedDistributionBlocked, true);
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("signed helper inventory fails closed when a required helper is missing signing evidence", async () => {
  const {
    buildSignedHelperInventory,
    validateSignedHelperInventory,
  } = await import("../src/signed-helper-inventory.mjs");

  const inventory = buildSignedHelperInventory({
    releaseArtifacts: [
      signedHelper("gateway-overlay-windows"),
    ],
  });
  const validation = validateSignedHelperInventory(inventory);

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "missing-required-helper-artifact",
  ]);
  assert.equal(validation.violations[0].id, "cua-driver-windows-x64");
});

test("Phase 0.13 has an executable signed helper inventory smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.13"], "node src/phase-0-13-signed-helper-inventory.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.13"], "signed-helper-inventory");

  const result = await runNode(["src/phase-0-13-signed-helper-inventory.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.13");
  assert.equal(report.benchmark, "signed-helper-inventory");
  assert.equal(report.requiredHelperCount, 2);
  assert.equal(report.signedRequiredHelperCount, 2);
  assert.equal(report.timestampedRequiredHelperCount, 2);
  assert.equal(report.reservedHelperCount, 1);
  assert.equal(report.unsignedDistributionBlocked, true);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function signedHelper(id) {
  return {
    id,
    kind: "windows-helper",
    sha256: "a".repeat(64),
    signature: {
      status: "valid",
      verifiedBy: "signtool verify /pa",
      timestamped: true,
    },
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
