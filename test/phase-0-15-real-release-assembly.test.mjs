import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { runRealReleaseAssemblyPhase } from "../src/phase-0-15-real-release-assembly.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Phase 0.15 orchestrates exact packages complete ZIP and offline SDK smoke", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-phase-0-15-"));
  roots.push(root);
  const zipPath = join(root, "release", "agent-computer-use-mcp-0.0.1-windows-x64.zip");
  await mkdir(dirname(zipPath), { recursive: true });
  await writeFile(zipPath, "zip-fixture");
  const calls = [];
  const report = await runRealReleaseAssemblyPhase({
    version: "0.0.1",
    sourceCommit: "a".repeat(40),
    generatedAt: "2026-07-11T00:00:00.000Z",
    corePackageRoot: join(root, "core"),
    platformPackageRoot: join(root, "platform"),
    outputRoot: join(root, "release"),
    buildCore: async (options) => { calls.push(["core", options]); },
    buildPlatform: async (options) => { calls.push(["platform", options]); },
    assemble: async (options) => {
      calls.push(["assemble", options]);
      return {
        status: "passed",
        inventoryComparison: { status: "identical" },
        assets: [{ name: "agent-computer-use-mcp-0.0.1-windows-x64.zip", path: zipPath }],
      };
    },
    smoke: async (options) => {
      calls.push(["smoke", options]);
      return {
        status: "passed",
        toolsListed: true,
        healthPassed: true,
        doctorPassed: true,
        platformVerified: true,
        networkDisabled: true,
        ocrInitialized: true,
        ocrPrewarmCompleted: true,
      };
    },
  });

  assert.deepEqual(calls.map(([name]) => name), ["core", "platform", "assemble", "smoke"]);
  assert.equal(report.status, "passed");
  assert.equal(report.benchmark, "npm-platform-release-assembly");
  assert.equal(report.platformInventoryIdentical, true);
  assert.equal(report.standardMcpSmokePassed, true);
  assert.equal(report.platformVerifiedBeforeMcp, true);
  assert.equal(report.offlineOcrVerified, true);
  assert.equal(report.firstEnableDownloadCount, 0);
  assert.equal(report.runtimeNetworkAllowed, false);
  assert.equal(report.offlineBundleMaxBytes, 310 * 1024 * 1024);
  assert.equal(report.startsDesktopControl, false);
});
