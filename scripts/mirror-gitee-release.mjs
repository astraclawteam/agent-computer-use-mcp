import { readFile } from "node:fs/promises";

import { mirrorGiteeRelease } from "../src/gitee-release-mirror.mjs";
import { loadReleaseAssets, versionFromTag } from "./gitee-release-assets.mjs";

const tag = required("RELEASE_TAG");
const report = await mirrorGiteeRelease({
  owner: required("GITEE_OWNER"),
  repo: required("GITEE_REPO"),
  tag,
  sourceCommit: required("RELEASE_SOURCE_COMMIT"),
  releaseNotes: await readFile(required("RELEASE_NOTES_PATH"), "utf8"),
  token: required("GITEE_TOKEN"),
  assets: await loadReleaseAssets(required("RELEASE_ASSET_ROOT"), versionFromTag(tag)),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`gitee.config_missing: ${name}`);
  return value;
}
