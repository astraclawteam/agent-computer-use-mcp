import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildReleaseArtifactVerification, validateReleaseArtifactVerification } from "../src/release-artifact-verification.mjs";
import { releaseAssetNames } from "../src/platform-package-contract.mjs";

test("release artifact verification requires exact release assets and hashes", () => {
  const report = buildReleaseArtifactVerification({
    packageJson: { name: "agent-computer-use-mcp", version: "0.0.1" },
    artifacts: releaseAssetNames("0.0.1").map((name) => ({ name, bytes: name })),
  });
  assert.equal(report.status, "passed");
  assert.equal(report.artifacts.length, 6);
  assert.equal(report.artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/u.test(sha256)), true);
});

test("release artifact verification fails closed for missing asset or hash", () => {
  const packageJson = { name: "agent-computer-use-mcp", version: "0.0.1" };
  const report = buildReleaseArtifactVerification({
    packageJson,
    artifacts: releaseAssetNames("0.0.1").map((name) => ({ name, bytes: name })),
  });
  report.artifacts.pop();
  report.artifacts[0].sha256 = null;
  const validation = validateReleaseArtifactVerification(report, { packageJson });
  assert.equal(validation.status, "failed");
  assert.deepEqual(validation.violations.map(({ code }) => code), [
    "release-asset-inventory-mismatch",
    "missing-artifact-hash",
  ]);
});

test("Phase 0.12 has an executable release artifact identity smoke", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:0.12"], "node src/phase-0-12-release-artifacts.mjs");
  const result = await runNode("src/phase-0-12-release-artifacts.mjs");
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.artifactCount, 6);
  assert.equal(report.hashVerifiedArtifactCount, 6);
});

function runNode(path) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
