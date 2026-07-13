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
  assert.equal(gate.commercialEligible, false);
  assert.equal(gate.commercialRequired, false);
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
    "npm run phase:0.14",
    "npm run phase:0.15",
    "npm run phase:7.8",
    "npm run phase:7.9",
    "npm run package:foundation",
    "npm run package:dry-run",
    "npm run assets:manifest",
  ]);
  assert.equal(gate.invariants.every((invariant) => invariant.required === true), true);
  assert.ok(gate.evidence.some((item) => item.id === "release-metadata-changelog"));
  assert.ok(gate.evidence.some((item) => item.id === "release-artifact-verification"));
  assert.ok(gate.evidence.some((item) => item.id === "platform-native-inventory"));
  assert.ok(gate.evidence.some((item) => item.id === "protected-npm-release"));
  assert.ok(gate.evidence.some((item) => item.id === "real-release-assembly" && item.command === "npm run phase:0.15"));
  assert.ok(gate.evidence.some((item) => item.id === "offline-install-proof"));
  assert.ok(gate.evidence.some((item) => item.id === "first-enable-safety"));
  assert.ok(gate.evidence.some((item) => item.id === "repair-entrypoint-catalog"));
  assert.ok(gate.evidence.some((item) => item.id === "clean-install-degraded-proof"));
  assert.ok(gate.evidence.some((item) => item.id === "platform-package-integrity"));
  assert.ok(gate.evidence.some((item) => item.id === "offline-package-identity"));
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

test("stable 1.x readiness requires matching verified Commercial 1.0 evidence", async () => {
  const { buildReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  packageJson.version = "1.0.0";

  const missing = buildReleaseReadinessGate({ packageJson });
  assert.equal(missing.status, "failed");
  assert.equal(missing.commercialRequired, true);
  assert.equal(missing.commercialEligible, false);
  assert.equal(missing.violations.some((entry) => entry.code === "commercial-evidence-required"), true);

  const mismatched = buildReleaseReadinessGate({
    packageJson,
    commercialPromotion: promotionEvidence({ releaseTag: "v1.0.1" }),
  });
  assert.equal(mismatched.status, "failed");
  assert.equal(mismatched.violations.some((entry) => entry.code === "commercial-release-identity-mismatch"), true);

  const incompleteIdentity = promotionEvidence();
  delete incompleteIdentity.candidateIdentity.overlay;
  const incomplete = buildReleaseReadinessGate({ packageJson, commercialPromotion: incompleteIdentity });
  assert.equal(incomplete.status, "failed");
  assert.equal(incomplete.violations.some((entry) => entry.code === "commercial-release-identity-mismatch"), true);

  const passed = buildReleaseReadinessGate({ packageJson, commercialPromotion: promotionEvidence() });
  assert.equal(passed.status, "passed");
  assert.equal(passed.releaseGate, "stable-commercial");
  assert.equal(passed.commercialEligible, true);
  assert.ok(passed.evidence.some((entry) => entry.id === "commercial-promotion-evidence" && entry.required === true));
});

test("release readiness validation fails closed when a required script or invariant is missing", async () => {
  const { buildReleaseReadinessGate, validateReleaseReadinessGate } = await import("../src/release-readiness-gate.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const packageWithoutIntegrity = structuredClone(packageJson);
  delete packageWithoutIntegrity.scripts["phase:7.8"];

  const gate = buildReleaseReadinessGate({ packageJson });
  gate.invariants = gate.invariants.filter((invariant) => invariant.id !== "overlay-excluded-from-observation");

  const validation = validateReleaseReadinessGate(gate, { packageJson: packageWithoutIntegrity });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "missing-script",
    "missing-invariant",
  ]);
  assert.equal(validation.violations[0].script, "phase:7.8");
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
  assert.equal(report.commercialRequired, false);
  assert.equal(report.commercialEligible, false);
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
    "npm run phase:0.14",
    "npm run phase:0.15",
    "npm run phase:7.8",
    "npm run phase:7.9",
    "npm run package:foundation",
    "npm run package:dry-run",
    "npm run assets:manifest",
  ].filter((command) => commands.has(command));
}

function promotionEvidence(overrides = {}) {
  return {
    status: "passed",
    phase: "9.0",
    benchmark: "commercial-promotion-evidence",
    eligible: true,
    releaseTag: "v1.0.0",
    candidateIdentity: {
      gitCommit: "1".repeat(40),
      corePackage: { name: "agent-computer-use-mcp", version: "1.0.0", sha256: "a".repeat(64) },
      platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "1.0.0", sha256: "b".repeat(64) },
      driver: { id: "cua-driver", version: "0.7.1", sha256: "c".repeat(64) },
      overlay: { id: "gateway-overlay", sha256: "d".repeat(64) },
      ocrRuntime: { id: "onnxruntime-node", version: "1.27.0", sha256: "e".repeat(64) },
      modelPack: { id: "pp-ocr-v6-small", sha256: "f".repeat(64) },
    },
    violations: [],
    ...overrides,
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
