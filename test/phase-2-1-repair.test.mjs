import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 2.1 repair is approval-gated and does not execute by default", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const overlayCalls = [];
  const router = new ComputerUseProviderRouter({
    overlayRuntime: {
      async start(args) {
        overlayCalls.push({ method: "start", args });
        return { visible: true };
      },
    },
  });

  const result = await router.repair({ approved: false, dryRun: false });

  assert.equal(result.status, "approval_required");
  assert.equal(result.mode, "plan-only");
  assert.equal(result.executesImmediately, false);
  assert.equal(result.includeUserOverlay, false);
  assert.equal(result.startsDesktopControl, false);
  assert.equal(result.repairPlan.mode, "plan-only");
  assert.equal(result.repairPlan.actions.every((action) => action.executesImmediately === false), true);
  assert.deepEqual(overlayCalls, []);

  await router.close();
});

test("Phase 2.1 has an executable repair smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.1"], "node src/phase-2-1-repair.mjs");

  const result = await runNode(["src/phase-2-1-repair.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.1");
  assert.equal(report.benchmark, "mcp-repair-approval-gate");
  assert.equal(report.repairStatus, "approval_required");
  assert.equal(report.executesImmediately, false);
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
