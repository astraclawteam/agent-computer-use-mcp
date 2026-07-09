import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  createProcessSupervisor,
  getComputerUseChildProcessSpecs,
} from "../src/process-supervisor.mjs";

test("process supervisor reports healthy managed children", () => {
  const supervisor = createProcessSupervisor({
    processFactory: fakeProcessFactory(),
  });

  const overlay = supervisor.ensure("overlay", {
    command: "overlay.exe",
    args: ["--user-only"],
    recoverAction: "restart-overlay",
  });
  const ocr = supervisor.ensure("ocr-sidecar", {
    command: "node",
    args: ["ocr-sidecar.mjs", "serve"],
    recoverAction: "restart-ocr-sidecar",
  });

  const health = supervisor.health();

  assert.equal(overlay.status, "running");
  assert.equal(ocr.status, "running");
  assert.equal(health.status, "healthy");
  assert.equal(health.children.length, 2);
  assert.deepEqual(health.recoverActions, []);
  assert.equal(health.includeUserOverlay, false);
});

test("process supervisor turns crashed children into structured degraded state", () => {
  const factory = fakeProcessFactory();
  const supervisor = createProcessSupervisor({ processFactory: factory });
  const overlay = supervisor.ensure("overlay", {
    command: "overlay.exe",
    args: [],
    recoverAction: "restart-overlay",
  });

  overlay.handle.emitExit(42, null);
  const health = supervisor.health();

  assert.equal(health.status, "degraded");
  assert.equal(health.children[0].status, "crashed");
  assert.equal(health.children[0].exitCode, 42);
  assert.deepEqual(health.recoverActions, [
    {
      id: "restart-overlay",
      kind: "process-restart",
      child: "overlay",
      reason: "crashed",
      executesImmediately: false,
    },
  ]);
});

test("process supervisor health output does not expose raw process handles", () => {
  const supervisor = createProcessSupervisor({
    processFactory: fakeProcessFactory(),
  });
  const child = supervisor.ensure("overlay", {
    command: "overlay.exe",
    args: [],
    recoverAction: "restart-overlay",
  });

  const health = supervisor.health();

  assert.equal(typeof child.handle?.kill, "function");
  assert.equal(Object.hasOwn(health.children[0], "handle"), false);
});

test("process supervisor restart recovers a crashed child without executing implicitly", () => {
  const factory = fakeProcessFactory();
  const supervisor = createProcessSupervisor({ processFactory: factory });
  const ocr = supervisor.ensure("ocr-sidecar", {
    command: "node",
    args: ["ocr-sidecar.mjs", "serve"],
    recoverAction: "restart-ocr-sidecar",
  });
  ocr.handle.emitExit(1, null);

  const planned = supervisor.recover("restart-ocr-sidecar", { approved: false });
  const recovered = supervisor.recover("restart-ocr-sidecar", { approved: true });
  const health = supervisor.health();

  assert.equal(planned.status, "approval_required");
  assert.equal(planned.executesImmediately, false);
  assert.equal(recovered.status, "restarted");
  assert.equal(recovered.child, "ocr-sidecar");
  assert.equal(health.status, "healthy");
  assert.equal(factory.starts.length, 2);
  assert.equal(health.includeUserOverlay, false);
});

test("process supervisor defines commercial child specs for overlay OCR and cua-driver", () => {
  const specs = getComputerUseChildProcessSpecs();

  assert.deepEqual(Object.keys(specs).sort(), ["cua-driver-mcp", "ocr-sidecar", "overlay"]);
  assert.equal(specs.overlay.recoverAction, "restart-overlay");
  assert.equal(specs["ocr-sidecar"].recoverAction, "restart-ocr-sidecar");
  assert.equal(specs["cua-driver-mcp"].recoverAction, "restart-cua-driver-mcp");
  assert.equal(specs.overlay.includeUserOverlay, false);
  assert.equal(specs["ocr-sidecar"].includeUserOverlay, false);
  assert.equal(specs["cua-driver-mcp"].includeUserOverlay, false);
});

test("Phase 2.7 has an executable process supervisor smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.7"], "node src/phase-2-7-process-supervisor.mjs");

  const result = await runNode(["src/phase-2-7-process-supervisor.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.7");
  assert.equal(report.benchmark, "process-supervisor-recovery");
  assert.equal(report.degradedAfterCrash, true);
  assert.equal(report.recoverActionPlanned, true);
  assert.equal(report.restartedAfterApproval, true);
  assert.equal(report.supervisedChildren, 3);
  assert.equal(report.driverCrashPlanned, true);
  assert.equal(report.includeUserOverlay, false);
});

function fakeProcessFactory() {
  const starts = [];
  return {
    starts,
    start(spec) {
      const handle = {
        pid: starts.length + 1000,
        killed: false,
        listeners: new Map(),
        on(event, listener) {
          this.listeners.set(event, listener);
        },
        kill() {
          this.killed = true;
        },
        emitExit(code, signal) {
          this.listeners.get("exit")?.(code, signal);
        },
        emitError(error) {
          this.listeners.get("error")?.(error);
        },
      };
      starts.push({ spec, handle });
      return handle;
    },
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
