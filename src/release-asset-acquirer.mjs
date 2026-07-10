import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function acquireReleaseAssets(options = {}) {
  const lock = options.lock;
  const cacheRoot = resolve(options.cacheRoot);
  const allowNetwork = options.allowNetwork === true;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const onProgress = options.onProgress ?? (() => {});
  if (!Array.isArray(lock?.assets) || lock.assets.length === 0) {
    throw releaseError("release.asset_lock_invalid", "Release asset lock has no assets");
  }

  const acquired = [];
  for (const asset of lock.assets) {
    const blobPath = cachePath(cacheRoot, asset.source.sha256);
    const cacheValid = await verifyExactFile(blobPath, asset.source);
    if (cacheValid) {
      onProgress(progress(asset.id, "cache_verified", asset.source.sizeBytes, asset.source.sizeBytes));
      acquired.push(record(asset, blobPath, true));
      continue;
    }

    await rm(blobPath, { force: true });
    if (!allowNetwork) {
      throw releaseError("release.asset_offline_missing", `Locked release asset is not cached: ${asset.id}`);
    }
    acquired.push(await downloadAsset({ asset, blobPath, fetchImpl, onProgress }));
  }
  return acquired;
}

async function downloadAsset({ asset, blobPath, fetchImpl, onProgress }) {
  await mkdir(dirname(blobPath), { recursive: true });
  const partPath = `${blobPath}.${randomUUID()}.part`;
  let handle;
  try {
    onProgress(progress(asset.id, "download_started", 0, asset.source.sizeBytes));
    let response;
    try {
      response = await fetchImpl(asset.source.url, { redirect: "follow" });
    } catch (cause) {
      const error = releaseError("release.asset_download_failed", `Release asset transport failed: ${asset.id}`);
      error.transportCode = cause?.cause?.code ?? cause?.code ?? "unknown";
      throw error;
    }
    if (!response?.ok || !response.body) {
      throw releaseError(
        "release.asset_download_failed",
        `Release asset download failed: ${asset.id} (${response?.status ?? "no-response"})`,
      );
    }
    validateResponseUrl(response.url || asset.source.url);

    handle = await open(partPath, "wx");
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      sizeBytes += bytes.length;
      if (sizeBytes > asset.source.sizeBytes) {
        throw releaseError("release.asset_size_mismatch", `Release asset is larger than locked size: ${asset.id}`);
      }
      hash.update(bytes);
      await handle.write(bytes);
      onProgress(progress(asset.id, "downloading", sizeBytes, asset.source.sizeBytes));
    }
    await handle.sync();
    await handle.close();
    handle = null;

    const actualHash = hash.digest("hex");
    if (sizeBytes !== asset.source.sizeBytes) {
      throw releaseError("release.asset_size_mismatch", `Release asset size does not match lock: ${asset.id}`);
    }
    if (actualHash !== asset.source.sha256) {
      throw releaseError("release.asset_hash_mismatch", `Release asset hash does not match lock: ${asset.id}`);
    }
    await rename(partPath, blobPath);
    onProgress(progress(asset.id, "verified", sizeBytes, sizeBytes));
    return record(asset, blobPath, false);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(partPath, { force: true });
  }
}

async function verifyExactFile(path, expected) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size !== expected.sizeBytes) return false;
  const hash = createHash("sha256").update(await readFile(path)).digest("hex");
  return hash === expected.sha256;
}

function validateResponseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw releaseError("release.asset_redirect_forbidden", "Release asset response URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw releaseError("release.asset_redirect_forbidden", "Release asset redirect left the approved HTTPS boundary");
  }
}

function cachePath(cacheRoot, hash) {
  return join(cacheRoot, "sha256", hash.slice(0, 2), hash, "blob");
}

function record(asset, path, cacheHit) {
  return {
    id: asset.id,
    version: asset.version,
    path,
    sizeBytes: asset.source.sizeBytes,
    sha256: asset.source.sha256,
    cacheHit,
    sourceUrl: asset.source.url,
  };
}

function progress(assetId, phase, bytesReceived, totalBytes) {
  return { assetId, phase, bytesReceived, totalBytes };
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
