import { resolve } from "node:path";

import { acquireReleaseAssets } from "../src/release-asset-acquirer.mjs";
import { loadReleaseAssetLock } from "../src/release-asset-lock.mjs";

const lock = await loadReleaseAssetLock("release/windows-x64-assets.lock.json");
const assets = await acquireReleaseAssets({
  lock,
  cacheRoot: resolve("artifacts/release-cache"),
  allowNetwork: true,
});

process.stdout.write(`${JSON.stringify({
  status: "passed",
  platform: lock.platform,
  assetCount: assets.length,
  totalBytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
  cacheHitCount: assets.filter((asset) => asset.cacheHit).length,
  assets: assets.map(({ id, version, sizeBytes, sha256, cacheHit }) => ({
    id,
    version,
    sizeBytes,
    sha256,
    cacheHit,
  })),
  startsDesktopControl: false,
  includeUserOverlay: false,
}, null, 2)}\n`);
