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
  assert.equal(metadata.publicContract, "computer.* MCP tools and structuredContent schemas");
  assert.equal(metadata.upgradeStrategy, "side-by-side-assets-in-place-package");
  assert.equal(metadata.rollbackStrategy, "retain previous asset manifest until next successful doctor run");
  assert.equal(metadata.changelog.path, "CHANGELOG.md");
  assert.equal(metadata.changelog.requiredHeading, `## ${packageJson.version}`);
  assert.deepEqual(metadata.artifacts.map((artifact) => artifact.name), [
    "npm-pack-tarball",
    "offline-asset-manifest",
    "package-foundation-report",
    "release-readiness-gate",
    "release-artifact-verification",
    "offline-install-proof",
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
  assert.equal(validation.status, "passed");
  assert.deepEqual(validation.violations, []);
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
  assert.equal(report.changelogEntryPresent, true);
  assert.equal(report.artifactCount, 16);
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
