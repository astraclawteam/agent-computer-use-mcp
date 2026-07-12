import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { mirrorGiteeRelease } from "../src/gitee-release-mirror.mjs";
import { prepareGiteeReleaseAssets } from "../src/gitee-release-parts.mjs";
import { loadReleaseAssets, versionFromTag } from "./gitee-release-assets.mjs";

const tag = required("RELEASE_TAG");
const sourceCommit = required("RELEASE_SOURCE_COMMIT");
const assetRoot = required("RELEASE_ASSET_ROOT");
const prepared = await prepareGiteeReleaseAssets({
  assets: await loadReleaseAssets(assetRoot, versionFromTag(tag)),
  outputRoot: join(assetRoot, ".gitee-delivery"),
  tag,
  sourceCommit,
});
const report = await mirrorGiteeRelease({
  owner: required("GITEE_OWNER"),
  repo: required("GITEE_REPO"),
  tag,
  sourceCommit,
  releaseNotes: await readFile(required("RELEASE_NOTES_PATH"), "utf8"),
  token: required("GITEE_TOKEN"),
  assets: prepared.assets,
  originals: prepared.originals,
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`gitee.config_missing: ${name}`);
  return value;
}
