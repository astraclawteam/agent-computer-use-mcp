import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { getInstallLayout } from "./package-foundation.mjs";

export function resolveActiveAssetEntryPoint(assetId, options = {}) {
  return inspectActiveAssetEntryPoint(assetId, options).entryPoint ?? null;
}

export function inspectActiveAssetEntryPoint(assetId, options = {}) {
  let state;
  let programRoot;
  try {
    programRoot = resolve(options.programRoot ?? getInstallLayout({
      platform: options.platform ?? process.platform,
      env: options.env ?? process.env,
    }).cacheRoot);
    const statePath = options.statePath ?? join(programRoot, "state", "asset-state.json");
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return unavailable("asset.state_unavailable");
  }
  try {
    if (state.schemaVersion !== 1 || typeof state.currentReleaseId !== "string" || !Array.isArray(state.assets)) {
      return unavailable("asset.state_invalid");
    }
    const asset = state.assets.find((candidate) => candidate?.id === assetId);
    if (!asset || !Array.isArray(asset.files) || asset.files.length === 0) {
      return unavailable("asset.not_active");
    }

    const assetsRoot = join(programRoot, "assets");
    const assetRoot = resolve(asset.root);
    const entryPoint = resolve(asset.entryPoint);
    if (!existsSync(entryPoint)) return unavailable("asset.entry_point_missing");
    if (pathContainsLink(assetsRoot, assetRoot) || pathContainsLink(assetRoot, entryPoint)) {
      return unavailable("asset.linked_path");
    }
    const canonicalAssetsRoot = realpathSync.native(assetsRoot);
    const canonicalAssetRoot = realpathSync.native(assetRoot);
    const canonicalEntryPoint = realpathSync.native(entryPoint);
    if (!pathIsInside(canonicalAssetsRoot, canonicalAssetRoot)
      || !pathIsInside(canonicalAssetRoot, canonicalEntryPoint)) {
      return unavailable("asset.path_outside_root");
    }
    for (const file of asset.files) {
      if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.sizeBytes)
        || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) return unavailable("asset.file_metadata_invalid");
      const filePath = resolve(assetRoot, ...file.path.split("/"));
      if (pathContainsLink(assetRoot, filePath)) return unavailable("asset.linked_path");
      if (!pathIsInside(canonicalAssetRoot, realpathSync.native(filePath))) {
        return unavailable("asset.path_outside_root");
      }
      const info = statSync(filePath);
      if (!info.isFile()) return unavailable("asset.file_unavailable");
      if (info.size !== file.sizeBytes) return unavailable("asset.size_mismatch");
      const actualSha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      if (actualSha256 !== file.sha256) return unavailable("asset.hash_mismatch");
    }
    return { status: "ready", entryPoint };
  } catch {
    return unavailable("asset.file_unavailable");
  }
}

function unavailable(reason) {
  return { status: "unavailable", reason, entryPoint: null };
}

function pathIsInside(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function pathContainsLink(root, candidate) {
  let current = resolve(root);
  if (lstatSync(current).isSymbolicLink()) return true;
  const lexicalPath = relative(current, resolve(candidate));
  const canonicalRoot = realpathSync.native(current);
  const canonicalCandidate = realpathSync.native(candidate);
  const canonicalPath = relative(canonicalRoot, canonicalCandidate);
  const path = relativePathIsInside(lexicalPath) ? lexicalPath : canonicalPath;
  for (const segment of path.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function relativePathIsInside(path) {
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}
