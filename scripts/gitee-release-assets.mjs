import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { releaseAssetNames } from "../src/platform-package-contract.mjs";

export async function loadReleaseAssets(root, version) {
  const assetRoot = resolve(root);
  return Promise.all(releaseAssetNames(version).map(async (name) => {
    const path = join(assetRoot, name);
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) throw new Error(`gitee.local_asset_missing: ${name}`);
    const bytes = await readFile(path);
    return {
      name,
      path,
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
}

export function versionFromTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(tag ?? "");
  if (!match) throw new Error(`gitee.tag_invalid: ${tag}`);
  return match[1];
}
