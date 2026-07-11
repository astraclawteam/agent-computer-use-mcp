import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertOfflineBundleSize, WINDOWS_X64_OFFLINE_MAX_BYTES } from "../src/release-size-policy.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "../src/release-target.mjs";

export async function buildWindowsReleaseSizeReport({ manifestPath, artifactRoot } = {}) {
  const resolvedManifestPath = resolve(required(manifestPath, "release.manifest_path_missing"));
  const root = resolve(required(artifactRoot, "release.artifact_root_missing"));
  const manifest = JSON.parse(await readFile(resolvedManifestPath, "utf8"));
  if (manifest.target !== "windows-x64") throw releaseError("release.target_mismatch", String(manifest.target));
  const offlineArtifact = manifest.artifacts?.find(({ name }) => name?.endsWith("-windows-x64.zip"));
  if (!offlineArtifact || basename(offlineArtifact.name) !== offlineArtifact.name) {
    throw releaseError("release.offline_bundle_identity_mismatch", "artifact missing");
  }
  const offlinePath = resolve(root, offlineArtifact.name);
  if (offlinePath !== join(root, offlineArtifact.name)) {
    throw releaseError("release.offline_bundle_identity_mismatch", "path escape");
  }
  const fileStat = await stat(offlinePath);
  const offlineSize = assertOfflineBundleSize({
    target: WINDOWS_X64_RELEASE_TARGET,
    sizeBytes: fileStat.size,
  });
  if (offlineArtifact.sizeBytes !== fileStat.size || offlineArtifact.sha256 !== await sha256File(offlinePath)) {
    throw releaseError("release.offline_bundle_identity_mismatch", offlineArtifact.name);
  }
  if (!Array.isArray(manifest.platformInventory) || manifest.platformInventory.length === 0) {
    throw releaseError("release.platform_inventory_invalid", "empty");
  }
  let previous = "";
  let platformPayloadBytes = 0;
  for (const file of manifest.platformInventory) {
    if (typeof file.path !== "string" || file.path <= previous
      || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0
      || !/^[a-f0-9]{64}$/u.test(file.sha256 ?? "")) {
      throw releaseError("release.platform_inventory_invalid", String(file.path));
    }
    previous = file.path;
    platformPayloadBytes += file.sizeBytes;
  }
  return {
    status: "passed",
    target: "windows-x64",
    offlineBundleSizeBytes: offlineSize.sizeBytes,
    offlineBundleMiB: toMiB(offlineSize.sizeBytes),
    offlineBundleMaxBytes: offlineSize.maxBytes,
    offlineBundleMaxMiB: toMiB(offlineSize.maxBytes),
    platformFileCount: manifest.platformInventory.length,
    platformPayloadBytes,
    platformPayloadMiB: toMiB(platformPayloadBytes),
  };
}

async function runCli() {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const artifactRoot = resolve(
    process.env.AGENT_COMPUTER_USE_RELEASE_OUTPUT_ROOT
      ?? join("artifacts/platform-release", packageJson.version),
  );
  const manifestPath = resolve(
    process.env.AGENT_COMPUTER_USE_RELEASE_MANIFEST_PATH
      ?? join(artifactRoot, "release-manifest.json"),
  );
  const report = await buildWindowsReleaseSizeReport({ manifestPath, artifactRoot });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function toMiB(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, code);
  return value;
}

function releaseError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
