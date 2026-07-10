import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { WINDOWS_X64_ONNX_REQUIRED_FILES } from "../src/release-runtime-selector.mjs";
import { assertOfflineBundleSize, WINDOWS_X64_OFFLINE_MAX_BYTES } from "../src/release-size-policy.mjs";
import { assertReleaseTarget, sameReleaseTarget } from "../src/release-target.mjs";

const SUPPORTED_ONNX_VERSION = "1.27.0";

export async function buildWindowsReleaseSizeReport({ manifestPath, artifactRoot } = {}) {
  const resolvedManifestPath = resolve(required(manifestPath, "release.manifest_path_missing"));
  const root = resolve(required(artifactRoot, "release.artifact_root_missing"));
  const manifest = JSON.parse(await readFile(resolvedManifestPath, "utf8"));
  const target = assertReleaseTarget(manifest.release?.target);
  const evidence = manifest.evidence;
  if (!sameReleaseTarget(evidence?.target, target)) {
    throw releaseError("release.target_mismatch", "Release evidence target does not match release identity");
  }

  const offlineArtifact = (manifest.artifacts ?? [])
    .find((artifact) => artifact.id === "windows-offline-bundle");
  if (!offlineArtifact || basename(offlineArtifact.fileName ?? "") !== offlineArtifact.fileName) {
    throw releaseError("release.offline_bundle_evidence_invalid", "Offline bundle artifact is missing or invalid");
  }
  const offlinePath = resolve(root, offlineArtifact.fileName);
  if (offlinePath !== join(root, offlineArtifact.fileName)) {
    throw releaseError("release.offline_bundle_evidence_invalid", "Offline bundle artifact escapes the artifact root");
  }
  const offlineStat = await stat(offlinePath);
  if (!offlineStat.isFile()) {
    throw releaseError("release.offline_bundle_evidence_invalid", "Offline bundle artifact is not a file");
  }
  const offlineSize = assertOfflineBundleSize({ target, sizeBytes: offlineStat.size });
  if (offlineArtifact.sizeBytes !== offlineSize.sizeBytes
    || evidence?.offlineBundleSizeBytes !== offlineSize.sizeBytes
    || evidence?.offlineBundleMaxBytes !== offlineSize.maxBytes) {
    throw releaseError("release.offline_bundle_size_mismatch", "Offline bundle evidence does not match the assembled file");
  }

  const runtimeSelection = evidence?.runtimeSelection;
  const retainedFiles = runtimeSelection?.retainedNativeFiles;
  if (!sameReleaseTarget(runtimeSelection?.target, target)
    || runtimeSelection?.packageVersion !== SUPPORTED_ONNX_VERSION
    || !sameStringArray(retainedFiles, WINDOWS_X64_ONNX_REQUIRED_FILES)
    || !positiveSafeInteger(runtimeSelection?.retainedNativeBytes)
    || !positiveSafeInteger(runtimeSelection?.removedNativeBytes)) {
    throw releaseError("release.runtime_evidence_invalid", "ONNX Runtime evidence does not match the Windows x64 release contract");
  }

  if (!positiveSafeInteger(evidence?.lockedAssetCount)
    || !positiveSafeInteger(evidence?.assetCount)
    || !positiveSafeInteger(evidence?.blobCount)
    || evidence.assetCount > evidence.lockedAssetCount
    || evidence.blobCount > evidence.assetCount) {
    throw releaseError("release.asset_evidence_invalid", "Release asset and blob counts are invalid");
  }

  return {
    status: "passed",
    target,
    offlineBundleSizeBytes: offlineSize.sizeBytes,
    offlineBundleMiB: toMiB(offlineSize.sizeBytes),
    offlineBundleMaxBytes: offlineSize.maxBytes,
    offlineBundleMaxMiB: toMiB(offlineSize.maxBytes),
    runtimeSelection,
    lockedAssetCount: evidence.lockedAssetCount,
    assetCount: evidence.assetCount,
    blobCount: evidence.blobCount,
  };
}

async function runCli() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const artifactRoot = resolve(
    process.env.AGENT_COMPUTER_USE_RELEASE_OUTPUT_ROOT
      ?? join("artifacts/windows-release", packageJson.version),
  );
  const manifestPath = resolve(
    process.env.AGENT_COMPUTER_USE_RELEASE_MANIFEST_PATH
      ?? join(artifactRoot, `${packageJson.name}-${packageJson.version}-release-manifest.json`),
  );
  const report = await buildWindowsReleaseSizeReport({ manifestPath, artifactRoot });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function toMiB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, code);
  return value;
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  await runCli();
}
