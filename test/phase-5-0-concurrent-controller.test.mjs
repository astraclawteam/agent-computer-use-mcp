import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("concurrent request_access calls cannot create multiple active controllers", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const overlayCalls = [];
  let releaseFindWindow;
  const findWindowGate = new Promise((resolve) => {
    releaseFindWindow = resolve;
  });
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow(args) {
        calls.push({ method: "findWindow", args });
        await findWindowGate;
        return {
          windowId: `win-${calls.length}`,
          title: "Computer Use Lab",
          pid: 123,
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
    },
    overlayRuntime: {
      async start(args) {
        overlayCalls.push({ method: "start", args });
        return { visible: true, processId: 99 };
      },
      async stop(handle) {
        overlayCalls.push({ method: "stop", handle });
      },
    },
  });

  const first = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-a" });
  const second = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-b" })
    .then((value) => ({ ok: true, value }))
    .catch((error) => ({ ok: false, error }));

  releaseFindWindow();
  const firstResult = await first;
  const secondResult = await second;
  const state = await router.listState();

  assert.equal(firstResult.status, "granted");
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.error.code, "controller.request_in_progress");
  assert.equal(state.status, "active");
  assert.equal(state.activeController.agentId, "agent-a");
  assert.equal(calls.filter((call) => call.method === "findWindow").length, 1);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start"]);

  await router.cancel({ reason: "test-cleanup" });
});

test("Phase 5.0 has an executable concurrent controller smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:5.0"], "node src/phase-5-0-concurrent-controller.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["5.0"], "concurrent-controller-guard");

  const result = await runNode(["src/phase-5-0-concurrent-controller.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "5.0");
  assert.equal(report.benchmark, "concurrent-controller-guard");
  assert.equal(report.grantedCount, 1);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.activeControllerCount, 1);
  assert.equal(report.overlayStartCount, 1);
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
