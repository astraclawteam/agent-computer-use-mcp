import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildWindowsReleaseSizeReport } from "../scripts/windows-release-size-report.mjs";
import { WINDOWS_X64_OFFLINE_MAX_BYTES } from "../src/release-size-policy.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows release size report verifies the complete ZIP and platform inventory", async () => {
  const fixture = await createFixture();
  const report = await buildWindowsReleaseSizeReport(fixture);

  assert.equal(report.status, "passed");
  assert.equal(report.target, "windows-x64");
  assert.equal(report.offlineBundleSizeBytes, 1024);
  assert.equal(report.offlineBundleMaxBytes, WINDOWS_X64_OFFLINE_MAX_BYTES);
  assert.equal(report.platformFileCount, 2);
  assert.equal(report.platformPayloadBytes, 30);
});

test("Windows release size report rejects hash size and target mismatches", async () => {
  for (const mutate of [
    (manifest) => { manifest.artifacts[0].sha256 = "0".repeat(64); },
    (manifest) => { manifest.artifacts[0].sizeBytes += 1; },
    (manifest) => { manifest.target = "linux-x64"; },
  ]) {
    const fixture = await createFixture({ mutate });
    await assert.rejects(buildWindowsReleaseSizeReport(fixture), /release\.(?:offline_bundle_identity_mismatch|target_mismatch)/);
  }
});

test("Windows release size report rejects an oversized complete ZIP", async () => {
  const fixture = await createFixture({ sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES + 1 });
  await assert.rejects(buildWindowsReleaseSizeReport(fixture), /release\.offline_bundle_too_large/);
});

async function createFixture({ sizeBytes = 1024, mutate } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-platform-size-report-"));
  roots.push(root);
  const name = "agent-computer-use-mcp-0.0.1-windows-x64.zip";
  const zipPath = join(root, name);
  await writeFile(zipPath, "");
  await truncate(zipPath, sizeBytes);
  const sha256 = createHash("sha256").update(await readFile(zipPath)).digest("hex");
  const manifest = {
    schemaVersion: 1,
    version: "0.0.1",
    target: "windows-x64",
    platformInventory: [
      { path: "cua-driver/cua-driver.exe", sizeBytes: 10, sha256: "a".repeat(64) },
      { path: "models/pp-ocr-v6/det.onnx", sizeBytes: 20, sha256: "b".repeat(64) },
    ],
    artifacts: [{ name, sizeBytes, sha256 }],
  };
  mutate?.(manifest);
  const manifestPath = join(root, "release-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, artifactRoot: root };
}
