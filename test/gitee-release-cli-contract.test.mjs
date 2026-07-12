import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

for (const name of ["mirror", "verify"]) {
  test(`${name} CLI prepares quota-safe Gitee assets before API operations`, async () => {
    const source = await readFile(`scripts/${name}-gitee-release.mjs`, "utf8");
    const apiCall = source.slice(source.indexOf("const report"));
    const assetField = name === "mirror" ? "assets" : "expectedAssets";

    assert.match(source, /prepareGiteeReleaseAssets/u);
    assert.match(source, /outputRoot:[\s\S]*\.gitee-delivery/u);
    assert.match(apiCall, new RegExp(`${assetField}: prepared\\.assets`, "u"));
    assert.match(source, /originals: prepared\.originals/u);
    assert.doesNotMatch(apiCall, /await loadReleaseAssets/u);
  });
}
