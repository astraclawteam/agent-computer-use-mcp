import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 2.2 has an executable repair approval state smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.2"], "node src/phase-2-2-repair-approval.mjs");

  const result = await runNode(["src/phase-2-2-repair-approval.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.2");
  assert.equal(report.benchmark, "repair-approval-state");
  assert.equal(report.pendingStatus, "pending");
  assert.equal(report.expiredStatus, "approval_expired");
  assert.equal(report.revokedPendingApproval, null);
  assert.equal(report.executesImmediately, false);
  assert.equal(report.includeUserOverlay, false);
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
