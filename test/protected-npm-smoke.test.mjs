import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, test } from "node:test";

import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import {
  PROTECTED_LAUNCHER_TIMEOUT_MS,
  runProtectedLauncher,
  runProtectedNpmSmoke,
} from "../scripts/protected-npm-smoke.mjs";

const fixtureRoots = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("protected launcher allows a bounded slow-device integrity window", () => {
  assert.equal(PROTECTED_LAUNCHER_TIMEOUT_MS, 30_000);
});

test("protected package launcher verifies integrity and serves standard MCP", async () => {
  const outputRoot = await fixtureRoot();
  const report = await runProtectedNpmSmoke({ outputRoot });

  assert.equal(report.status, "passed");
  assert.equal(report.integrityVerified, true);
  assert.equal(report.platformVerified, true);
  assert.ok(report.toolNames.includes("computer.health"));
  assert.ok(report.toolNames.includes("computer.installation"));
  assert.equal(report.health.status, "ready");
  assert.equal(report.health.module, "agent-computer-use-mcp");
  assert.equal(report.health.includeUserOverlay, false);
  assert.equal(report.installationEntry, "dist/launcher.mjs");
  assert.equal(report.sourceEntryCount, 0);
  assert.equal(report.sourceMapCount, 0);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});

test("protected package launcher refuses to initialize without its exact platform package", async () => {
  const outputRoot = await fixtureRoot();
  await buildProtectedNpmPackage({ outputRoot });

  const result = await runProtectedLauncher({ outputRoot, args: ["--verify-only"] });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /platform\.package_missing/);
  assert.equal(result.stdout, "");
});

test("protected package launcher rejects tampered runtime before MCP initialization", async () => {
  const outputRoot = await fixtureRoot();
  await buildProtectedNpmPackage({ outputRoot });
  const serverPath = resolve(outputRoot, "dist/computer-use-mcp-server.mjs");
  const server = await readFile(serverPath, "utf8");
  await writeFile(serverPath, `${server}\nthis is invalid @@\n`, "utf8");

  const result = await runProtectedLauncher({ outputRoot, args: ["--verify-only"] });

  assert.equal(result.exitCode, 1);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /release\.integrity_mismatch/);
  assert.equal(result.stdout, "");
});

async function fixtureRoot() {
  const parent = resolve("artifacts/npm-release-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(resolve(parent, "package-"));
  fixtureRoots.push(root);
  return root;
}

