import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("policy deny proof covers password payment and private surfaces", async () => {
  const { createPolicyDenyProof } = await import("../src/policy-deny-proof.mjs");

  const proof = createPolicyDenyProof();

  assert.equal(proof.phase, "1.11");
  assert.equal(proof.status, "passed");
  assert.equal(proof.mode, "policy-deny-proof");
  assert.deepEqual(proof.deniedSurfaceIds, [
    "credential-manager-window",
    "payment-window",
    "private-browsing-window",
    "private-document-window",
    "password-field-action",
  ]);
  assert.equal(proof.denials.every((denial) => denial.allowed === false), true);
  assert.deepEqual(proof.denials.map((denial) => denial.code), [
    "policy.window_denied",
    "policy.window_denied",
    "policy.window_denied",
    "policy.window_denied",
    "policy.secure_field_denied",
  ]);
  assert.equal(proof.actionExecutionBlocked, true);
  assert.equal(proof.includeUserOverlay, false);
  assert.equal(proof.startsDesktopControl, false);
});

test("policy deny proof fails closed when any sensitive surface is allowed", async () => {
  const { createPolicyDenyProof } = await import("../src/policy-deny-proof.mjs");
  const permissivePolicy = {
    evaluateAccessRequest: () => ({ allowed: true, includeUserOverlay: false }),
    validateAction: () => ({ allowed: true, includeUserOverlay: false }),
  };

  const proof = createPolicyDenyProof({ policy: permissivePolicy });

  assert.equal(proof.status, "failed");
  assert.deepEqual(proof.violations.map((violation) => violation.id), [
    "credential-manager-window",
    "payment-window",
    "private-browsing-window",
    "private-document-window",
    "password-field-action",
  ]);
  assert.equal(proof.actionExecutionBlocked, false);
});

test("Phase 1.11 has an executable policy deny proof smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.11"], "node src/phase-1-11-policy-deny-proof.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["1.11"], "policy-deny-proof");

  const result = await runNode(["src/phase-1-11-policy-deny-proof.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "1.11");
  assert.equal(report.deniedSurfaceCount, 5);
  assert.equal(report.actionExecutionBlocked, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
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
