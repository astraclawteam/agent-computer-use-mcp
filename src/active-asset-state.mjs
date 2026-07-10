import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { getInstallLayout } from "./package-foundation.mjs";

export function resolveActiveAssetEntryPoint(assetId, options = {}) {
  try {
    const programRoot = resolve(options.programRoot ?? getInstallLayout({
      platform: options.platform ?? process.platform,
      env: options.env ?? process.env,
    }).cacheRoot);
    const statePath = options.statePath ?? join(programRoot, "state", "asset-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.schemaVersion !== 1 || typeof state.currentReleaseId !== "string" || !Array.isArray(state.assets)) {
      return null;
    }
    const asset = state.assets.find((candidate) => candidate?.id === assetId);
    if (!asset || !Array.isArray(asset.files) || asset.files.length === 0) return null;

    const assetsRoot = join(programRoot, "assets");
    const assetRoot = resolve(asset.root);
    const entryPoint = resolve(asset.entryPoint);
    if (!pathIsInside(assetsRoot, assetRoot) || !pathIsInside(assetRoot, entryPoint) || !existsSync(entryPoint)
      || pathContainsLink(assetsRoot, assetRoot) || pathContainsLink(assetRoot, entryPoint)) {
      return null;
    }
    for (const file of asset.files) {
      if (!file || typeof file.path !== "string" || !Number.isSafeInteger(file.sizeBytes)
        || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) return null;
      const filePath = resolve(assetRoot, ...file.path.split("/"));
      if (!pathIsInside(assetRoot, filePath) || pathContainsLink(assetRoot, filePath)) return null;
      const info = statSync(filePath);
      if (!info.isFile() || info.size !== file.sizeBytes) return null;
      const actualSha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
      if (actualSha256 !== file.sha256) return null;
    }
    return entryPoint;
  } catch {
    return null;
  }
}

function pathIsInside(root, candidate) {
  const path = relative(resolve(root), resolve(candidate));
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function pathContainsLink(root, candidate) {
  let current = resolve(root);
  if (lstatSync(current).isSymbolicLink()) return true;
  for (const segment of relative(current, resolve(candidate)).split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}
