import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("release artifact verification records hashes and valid signing evidence", async () => {
  const { buildReleaseArtifactVerification, validateReleaseArtifactVerification } = await import("../src/release-artifact-verification.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  const report = buildReleaseArtifactVerification({
    packageJson,
    artifacts: signedFixtureArtifacts(),
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  const validation = validateReleaseArtifactVerification(report, { packageJson });

  assert.equal(report.phase, "0.12");
  assert.equal(report.status, "passed");
  assert.equal(report.packageName, "agent-computer-use-mcp");
  assert.equal(report.packageVersion, packageJson.version);
  assert.equal(report.releaseTag, `v${packageJson.version}`);
  assert.equal(report.artifacts.length, 3);
  assert.deepEqual(report.artifacts.map((artifact) => [artifact.id, artifact.sha256]), [
    ["npm-pack-tarball", sha256("package-bytes")],
    ["gateway-overlay-windows", sha256("overlay-helper")],
    ["cua-driver-windows-x64", sha256("driver-helper")],
  ]);
  assert.equal(report.signingSummary.requiredHelperCount, 2);
  assert.equal(report.signingSummary.validSignedHelperCount, 2);
  assert.equal(report.unsignedDistributionBlocked, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("release artifact validation fails closed for missing hashes or helper signatures", async () => {
  const { buildReleaseArtifactVerification, validateReleaseArtifactVerification } = await import("../src/release-artifact-verification.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const report = buildReleaseArtifactVerification({
    packageJson,
    artifacts: [
      {
        id: "npm-pack-tarball",
        kind: "npm-tarball",
        path: "agent-computer-use-mcp-0.0.1.tgz",
        sha256: "",
      },
      {
        id: "gateway-overlay-windows",
        kind: "windows-helper",
        path: "gateway-overlay/GatewayComputerUseOverlay.exe",
        bytes: "overlay-helper",
        signature: { status: "unsigned", verifiedBy: "signtool verify /pa", timestamped: false },
      },
    ],
  });

  const validation = validateReleaseArtifactVerification(report, { packageJson });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "missing-artifact-hash",
    "invalid-helper-signature",
    "helper-signature-not-timestamped",
  ]);
});

test("Phase 0.12 has an executable release artifact smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.12"], "node src/phase-0-12-release-artifacts.mjs");
  assert.equal(packageJson.scripts["release:artifacts"], "node src/phase-0-12-release-artifacts.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.12"], "release-artifact-verification");

  const result = await runNode(["src/phase-0-12-release-artifacts.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.12");
  assert.equal(report.artifactCount, 3);
  assert.equal(report.requiredHelperCount, 2);
  assert.equal(report.validSignedHelperCount, 2);
  assert.equal(report.unsignedDistributionBlocked, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

function signedFixtureArtifacts() {
  return [
    {
      id: "npm-pack-tarball",
      kind: "npm-tarball",
      path: "agent-computer-use-mcp-0.0.1.tgz",
      bytes: "package-bytes",
    },
    {
      id: "gateway-overlay-windows",
      kind: "windows-helper",
      path: "gateway-overlay/GatewayComputerUseOverlay.exe",
      bytes: "overlay-helper",
      signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
    },
    {
      id: "cua-driver-windows-x64",
      kind: "windows-helper",
      path: "cua-driver/cua-driver.exe",
      bytes: "driver-helper",
      signature: { status: "valid", verifiedBy: "signtool verify /pa", timestamped: true },
    },
  ];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
