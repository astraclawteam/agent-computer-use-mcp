import { syncGiteeReleaseRef } from "../src/gitee-ref-sync.mjs";

const report = await syncGiteeReleaseRef({
  owner: required("GITEE_OWNER"),
  repo: required("GITEE_REPO"),
  tag: required("RELEASE_TAG"),
  sourceCommit: required("RELEASE_SOURCE_COMMIT"),
  mainCommit: process.env.GITEE_MAIN_COMMIT || required("RELEASE_SOURCE_COMMIT"),
  token: required("GITEE_TOKEN"),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`gitee.config_missing: ${name}`);
  return value;
}
