import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("release readiness gate captures the alpha release command contract", async () => {
  const { buildReleaseReadinessGate, validateReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  const gate = buildReleaseReadinessGate({ packageJson });
  const validation = validateReleaseReadinessGate(gate, { packageJson });

  assert.equal(gate.phase, "0.11");
  assert.equal(gate.status, "passed");
  assert.equal(gate.packageName, "agent-computer-use-mcp");
  assert.equal(gate.packageVersion, packageJson.version);
  assert.equal(gate.releaseGate, "alpha");
  assert.equal(gate.executionMode, "manifest-only");
  assert.equal(gate.startsDesktopControl, false);
  assert.equal(gate.includeUserOverlay, false);
  assert.ok(gate.commands.length >= 40);
  assert.deepEqual(requiredCommandSubset(gate), [
    "npm test",
    "npm run phase:0.10",
    "npm run phase:0.11",
    "npm run phase:0.12",
    "npm run phase:0.13",
    "npm run package:foundation",
    "npm run package:dry-run",
    "npm run assets:manifest",
    "npm run doctor:install-cache",
  ]);
  assert.equal(gate.invariants.every((invariant) => invariant.required === true), true);
  assert.ok(gate.evidence.some((item) => item.id === "release-metadata-changelog"));
  assert.ok(gate.evidence.some((item) => item.id === "release-artifact-verification"));
  assert.ok(gate.evidence.some((item) => item.id === "signed-helper-inventory"));
  assert.ok(gate.evidence.some((item) => item.id === "offline-install-cache-doctor"));
  assert.ok(gate.evidence.some((item) => item.id === "offline-install-proof"));
  assert.ok(gate.evidence.some((item) => item.id === "policy-deny-proof"));
  assert.ok(gate.evidence.some((item) => item.id === "control-approval-state"));
  assert.ok(gate.evidence.some((item) => item.id === "mcp-approval-compatibility"));
  assert.ok(gate.evidence.some((item) => item.id === "mcp-multi-client-stress"));
  assert.ok(gate.evidence.some((item) => item.id === "public-mcp-contract-review"));
  assert.ok(gate.evidence.some((item) => item.id === "daemon-session"));
  assert.ok(gate.evidence.some((item) => item.id === "daemon-session-doctor-repair"));
  assert.ok(gate.evidence.some((item) => item.id === "runtime-cleanup"));
  assert.ok(gate.evidence.some((item) => item.id === "runtime-cleanup-doctor-repair"));
  assert.ok(gate.evidence.some((item) => item.id === "perception-latency-budget"));
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("release readiness validation fails closed when a required script or invariant is missing", async () => {
  const { buildReleaseReadinessGate, validateReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageWithoutDoctor = structuredClone(packageJson);
  delete packageWithoutDoctor.scripts["doctor:install-cache"];

  const gate = buildReleaseReadinessGate({ packageJson });
  gate.invariants = gate.invariants.filter((invariant) => invariant.id !== "overlay-excluded-from-observation");

  const validation = validateReleaseReadinessGate(gate, { packageJson: packageWithoutDoctor });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "missing-script",
    "missing-invariant",
  ]);
  assert.equal(validation.violations[0].script, "doctor:install-cache");
  assert.equal(validation.violations[1].id, "overlay-excluded-from-observation");
});

test("Phase 0.11 has an executable release readiness smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.11"], "node src/phase-0-11-release-readiness.mjs");
  assert.equal(packageJson.scripts["release:readiness"], "node src/phase-0-11-release-readiness.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.11"], "release-readiness-gate");

  const result = await runNode(["src/phase-0-11-release-readiness.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.11");
  assert.equal(report.releaseGate, "alpha");
  assert.equal(report.commandCount >= 40, true);
  assert.equal(report.evidenceCount >= 20, true);
  assert.equal(report.invariantCount, 3);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

function requiredCommandSubset(gate) {
  const commands = new Set(gate.commands.map((command) => command.command));
  return [
    "npm test",
    "npm run phase:0.10",
    "npm run phase:0.11",
    "npm run phase:0.12",
    "npm run phase:0.13",
    "npm run package:foundation",
    "npm run package:dry-run",
    "npm run assets:manifest",
    "npm run doctor:install-cache",
  ].filter((command) => commands.has(command));
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
