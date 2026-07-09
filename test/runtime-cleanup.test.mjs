import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  cleanupRuntimeState,
} from "../src/runtime-cleanup.mjs";

const NOW = Date.parse("2026-07-09T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

test("runtime cleanup removes stale daemon locks and expired runtime files only", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-runtime-cleanup-"));
  await mkdir(join(runtimeRoot, "overlay"), { recursive: true });
  const staleLock = await createJsonFile(runtimeRoot, "daemon.lock.json", {
    module: "agent-computer-use-mcp",
    role: "mcp-daemon",
    pid: 4242,
    startedAt: "2026-07-08T00:00:00.000Z",
    includeUserOverlay: false,
  }, NOW - HOUR);
  const expiredTargetRect = await createFile(join(runtimeRoot, "overlay"), "target-rect.json", NOW - 4 * HOUR);
  const freshHeartbeat = await createFile(runtimeRoot, "heartbeat.json", NOW - 5 * 60 * 1000);

  const report = await cleanupRuntimeState({
    runtimeRoot,
    nowMs: NOW,
    maxRuntimeFileAgeMs: HOUR,
    dryRun: false,
    isProcessAlive: (pid) => pid !== 4242,
  });

  assert.equal(report.status, "completed");
  assert.equal(report.phase, "2.12");
  assert.equal(report.dryRun, false);
  assert.deepEqual(report.deleted.map((entry) => entry.reason).sort(), ["expired-runtime-file", "stale-daemon-lock"]);
  assert.equal(report.deletedCount, 2);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
  await assertMissing(staleLock);
  await assertMissing(expiredTargetRect);
  await assertExists(freshHeartbeat);
});

test("runtime cleanup dry run preserves stale files and active daemon locks", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-runtime-cleanup-dry-"));
  const activeLock = await createJsonFile(runtimeRoot, "daemon.lock.json", {
    module: "agent-computer-use-mcp",
    role: "mcp-daemon",
    pid: 2026,
    startedAt: "2026-07-08T00:00:00.000Z",
    includeUserOverlay: false,
  }, NOW - 8 * HOUR);
  const expiredFile = await createFile(runtimeRoot, "old-target-rect.json", NOW - 8 * HOUR);

  const report = await cleanupRuntimeState({
    runtimeRoot,
    nowMs: NOW,
    maxRuntimeFileAgeMs: HOUR,
    dryRun: true,
    isProcessAlive: (pid) => pid === 2026,
  });

  assert.equal(report.status, "planned");
  assert.equal(report.deletedCount, 0);
  assert.deepEqual(report.activeLocks.map((entry) => entry.pid), [2026]);
  assert.deepEqual(report.expired.map((entry) => entry.path), [expiredFile]);
  await assertExists(activeLock);
  await assertExists(expiredFile);
});

test("Phase 2.12 has an executable runtime cleanup smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.12"], "node src/phase-2-12-runtime-cleanup.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["2.12"], "runtime-cleanup");

  const result = await runNode(["src/phase-2-12-runtime-cleanup.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.12");
  assert.equal(report.benchmark, "runtime-cleanup");
  assert.equal(report.staleLockRemoved, true);
  assert.equal(report.expiredRuntimeFileRemoved, true);
  assert.equal(report.activeLockPreserved, true);
  assert.equal(report.dryRunPreservedExpiredFile, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

async function createFile(root, name, mtimeMs) {
  const path = join(root, name);
  await writeFile(path, "runtime", "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function createJsonFile(root, name, payload, mtimeMs) {
  const path = join(root, name);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const mtime = new Date(mtimeMs);
  await utimes(path, mtime, mtime);
  return path;
}

async function assertExists(path) {
  await stat(path);
}

async function assertMissing(path) {
  await assert.rejects(stat(path), /ENOENT/);
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
