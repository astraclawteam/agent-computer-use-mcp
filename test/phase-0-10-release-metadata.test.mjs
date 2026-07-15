import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("release metadata matches package version, tag, changelog, and upgrade policy", async () => {
  const { buildReleaseMetadata, validateReleaseMetadata } = await import("../src/release-metadata.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  const metadata = buildReleaseMetadata({
    packageJson,
    generatedAt: "2026-07-10T00:00:00.000Z",
  });
  const validation = validateReleaseMetadata(metadata, {
    packageJson,
    changelogText: readFileSync("CHANGELOG.md", "utf8"),
  });

  assert.equal(metadata.phase, "0.10");
  assert.equal(metadata.packageName, "agent-computer-use-mcp");
  assert.equal(metadata.packageVersion, packageJson.version);
  assert.equal(metadata.releaseTag, `v${packageJson.version}`);
  assert.equal(metadata.channel, "0.x-preview");
  assert.equal(metadata.commercialRequired, false);
  assert.equal(metadata.commercialEligible, false);
  assert.equal(metadata.publicContract, "computer.* MCP tools and structuredContent schemas");
  assert.equal(metadata.upgradeStrategy, "npm-install-exact-core-and-platform-version");
  assert.equal(metadata.rollbackStrategy, "npm-install-previous-exact-version");
  assert.equal(metadata.changelog.path, "CHANGELOG.md");
  assert.equal(metadata.changelog.requiredHeading, `## ${packageJson.version}`);
  assert.deepEqual(metadata.artifacts.map((artifact) => artifact.name), [
    "npm-pack-tarball",
    "offline-asset-manifest",
    "package-foundation-report",
    "release-readiness-gate",
    "release-artifact-verification",
    "platform-native-inventory",
    "protected-npm-release",
    "real-release-assembly",
    "offline-install-proof",
    "first-enable-safety",
    "repair-entrypoint-catalog",
    "clean-install-degraded-proof",
    "trusted-asset-cache-materializer",
    "policy-deny-proof",
    "control-approval-state",
    "mcp-approval-compatibility",
    "mcp-multi-client-stress",
    "public-mcp-contract-review",
    "daemon-session",
    "daemon-session-doctor-repair",
    "runtime-cleanup",
    "runtime-cleanup-doctor-repair",
    "perception-latency-budget",
  ]);
  assert.equal(metadata.artifacts[0].command, "npm run release:npm:pack");
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
});

test("stable metadata includes matching Commercial 1.0 promotion evidence", async () => {
  const { buildReleaseMetadata, validateReleaseMetadata } = await import("../src/release-metadata.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  packageJson.version = "1.0.0";
  const promotion = {
    status: "passed",
    phase: "9.0",
    benchmark: "commercial-promotion-evidence",
    eligible: true,
    agentE2eEligible: true,
    releaseTag: "v1.0.0",
    candidateIdentity: {
      gitCommit: "1".repeat(40),
      corePackage: { name: packageJson.name, version: packageJson.version, sha256: "a".repeat(64) },
      platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: packageJson.version, sha256: "b".repeat(64) },
      driver: { id: "cua-driver", version: "0.7.1", sha256: "c".repeat(64) },
      overlay: { id: "gateway-overlay", sha256: "d".repeat(64) },
      ocrRuntime: { id: "onnxruntime-node", version: "1.27.0", sha256: "e".repeat(64) },
      modelPack: { id: "pp-ocr-v6-small", sha256: "f".repeat(64) },
    },
    violations: [],
  };
  const metadata = buildReleaseMetadata({ packageJson, commercialPromotion: promotion });
  const validation = validateReleaseMetadata(metadata, { packageJson, changelogText: "## 1.0.0\n" });

  assert.equal(metadata.channel, "stable");
  assert.equal(metadata.commercialRequired, true);
  assert.equal(metadata.commercialEligible, true);
  assert.equal(metadata.commercialPromotion.agentE2eEligible, true);
  assert.ok(metadata.artifacts.some((entry) => entry.name === "commercial-promotion-evidence" && entry.command === "npm run phase:9.0"));
  assert.ok(metadata.artifacts.some((entry) => entry.name === "agent-e2e-qualification-evidence" && entry.command === "npm run phase:10.4"));
  assert.equal(validation.status, "passed");

  const incomplete = structuredClone(metadata);
  delete incomplete.commercialPromotion.candidateIdentity.driver;
  assert.equal(validateReleaseMetadata(incomplete, { packageJson, changelogText: "## 1.0.0\n" }).status, "failed");

  const invalidCommit = structuredClone(metadata);
  invalidCommit.commercialPromotion.candidateIdentity.gitCommit = "not-a-commit";
  assert.equal(validateReleaseMetadata(invalidCommit, { packageJson, changelogText: "## 1.0.0\n" }).status, "failed");

  const missingRuntime = structuredClone(metadata);
  delete missingRuntime.commercialPromotion.candidateIdentity.ocrRuntime;
  assert.equal(validateReleaseMetadata(missingRuntime, { packageJson, changelogText: "## 1.0.0\n" }).status, "failed");

  const legacyPromotion = structuredClone(promotion);
  delete legacyPromotion.agentE2eEligible;
  const legacyMetadata = buildReleaseMetadata({ packageJson, commercialPromotion: legacyPromotion });
  assert.equal(legacyMetadata.commercialEligible, false);
  assert.equal(validateReleaseMetadata(legacyMetadata, { packageJson, changelogText: "## 1.0.0\n" }).status, "failed");
});

test("release metadata validation fails closed for missing changelog or mismatched tag", async () => {
  const { buildReleaseMetadata, validateReleaseMetadata } = await import("../src/release-metadata.mjs");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const metadata = buildReleaseMetadata({ packageJson });
  metadata.releaseTag = "v9.9.9";

  const validation = validateReleaseMetadata(metadata, {
    packageJson,
    changelogText: "# Changelog\n\n## 9.9.9\n\n- Wrong entry.\n",
  });

  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map((violation) => violation.code), [
    "release-tag-mismatch",
    "changelog-entry-missing",
  ]);
});

test("Phase 0.10 has changelog and executable release metadata smoke script", async () => {
  assert.equal(existsSync("CHANGELOG.md"), true);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.10"], "node src/phase-0-10-release-metadata.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["0.10"], "release-metadata-changelog");

  const result = await runNode(["src/phase-0-10-release-metadata.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "0.10");
  assert.equal(report.releaseTag, `v${packageJson.version}`);
  assert.equal(report.commercialRequired, false);
  assert.equal(report.commercialEligible, false);
  assert.equal(report.changelogEntryPresent, true);
  assert.equal(report.artifactCount, 23);
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
