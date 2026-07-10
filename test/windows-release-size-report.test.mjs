import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WINDOWS_X64_ONNX_REQUIRED_FILES } from "../src/release-runtime-selector.mjs";
import { WINDOWS_X64_OFFLINE_MAX_BYTES } from "../src/release-size-policy.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "../src/release-target.mjs";
import { buildWindowsReleaseSizeReport } from "../scripts/windows-release-size-report.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Windows release size report verifies the real ZIP and selected runtime inventory", async () => {
  const fixture = await createFixture();

  const report = await buildWindowsReleaseSizeReport(fixture);

  assert.equal(report.status, "passed");
  assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
  assert.equal(report.offlineBundleSizeBytes, 1024);
  assert.equal(report.offlineBundleMaxBytes, WINDOWS_X64_OFFLINE_MAX_BYTES);
  assert.deepEqual(report.runtimeSelection.retainedNativeFiles, WINDOWS_X64_ONNX_REQUIRED_FILES);
  assert.equal(report.runtimeSelection.packageVersion, "1.27.0");
  assert.equal(report.lockedAssetCount, 5);
  assert.equal(report.assetCount, 2);
  assert.equal(report.blobCount, 2);
});

test("Windows release size report rejects missing runtime selection evidence", async () => {
  const fixture = await createFixture({ mutate(manifest) { delete manifest.evidence.runtimeSelection; } });

  await assert.rejects(
    () => buildWindowsReleaseSizeReport(fixture),
    (error) => error?.code === "release.runtime_evidence_invalid",
  );
});

test("Windows release size report rejects foreign runtime files", async () => {
  const fixture = await createFixture({
    mutate(manifest) {
      manifest.evidence.runtimeSelection.retainedNativeFiles = ["libonnxruntime.so"];
    },
  });

  await assert.rejects(
    () => buildWindowsReleaseSizeReport(fixture),
    (error) => error?.code === "release.runtime_evidence_invalid",
  );
});

test("Windows release size report rejects a manifest size that differs from the real ZIP", async () => {
  const fixture = await createFixture({
    mutate(manifest) {
      manifest.evidence.offlineBundleSizeBytes += 1;
    },
  });

  await assert.rejects(
    () => buildWindowsReleaseSizeReport(fixture),
    (error) => error?.code === "release.offline_bundle_size_mismatch",
  );
});

test("Windows release size report rejects an oversized real ZIP", async () => {
  const fixture = await createFixture({ sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES + 1 });

  await assert.rejects(
    () => buildWindowsReleaseSizeReport(fixture),
    (error) => error?.code === "release.offline_bundle_too_large",
  );
});

async function createFixture({ sizeBytes = 1024, mutate } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-release-size-report-"));
  roots.push(root);
  const fileName = "agent-computer-use-mcp-0.0.1-windows-x64-offline.candidate.zip";
  const offlinePath = join(root, fileName);
  await mkdir(root, { recursive: true });
  await writeFile(offlinePath, "", "utf8");
  await truncate(offlinePath, sizeBytes);
  const manifest = {
    schemaVersion: 1,
    release: {
      packageName: "agent-computer-use-mcp",
      version: "0.0.1",
      platform: "windows-x64",
      target: WINDOWS_X64_RELEASE_TARGET,
    },
    evidence: {
      target: WINDOWS_X64_RELEASE_TARGET,
      runtimeSelection: {
        target: WINDOWS_X64_RELEASE_TARGET,
        packageVersion: "1.27.0",
        retainedNativeFiles: WINDOWS_X64_ONNX_REQUIRED_FILES,
        retainedNativeBytes: 64_000_000,
        removedNativeBytes: 200_000_000,
      },
      offlineBundleSizeBytes: sizeBytes,
      offlineBundleMaxBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
      lockedAssetCount: 5,
      assetCount: 2,
      blobCount: 2,
    },
    artifacts: [{ id: "windows-offline-bundle", fileName, sizeBytes }],
  };
  mutate?.(manifest);
  const manifestPath = join(root, "agent-computer-use-mcp-0.0.1-release-manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifestPath, artifactRoot: root };
}
