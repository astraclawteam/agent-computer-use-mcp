import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 2.0 doctor reports install/runtime readiness without desktop control", async () => {
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

  const report = await router.doctor({ fast: true, includeInstallCache: true });

  assert.equal(report.module, "agent-computer-use-mcp");
  assert.equal(["healthy", "degraded", "unavailable"].includes(report.status), true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.runtime.phases["2.0"], "doctor-tool");
  assert.equal(report.installCache.includeUserOverlay, false);
  assert.equal(report.installCache.startsDesktopControl, false);
  assert.equal(report.repairPlan.mode, "plan-only");
  assert.deepEqual(overlayCalls, []);

  await router.close();
});

test("Phase 2.0 has an executable doctor smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.0"], "node src/phase-2-0-doctor.mjs");

  const result = await runNode(["src/phase-2-0-doctor.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.0");
  assert.equal(report.benchmark, "mcp-doctor-readiness");
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
