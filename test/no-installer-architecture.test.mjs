import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";

test("current product contains no installer or private native updater architecture", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(Object.keys(packageJson.scripts).some((name) => name.startsWith("installer:")), false);
  assert.equal(packageJson.files.some((entry) => /windows-installer/iu.test(entry)), false);
  await assert.rejects(stat("windows-installer"), { code: "ENOENT" });

  const server = await readFile("src/computer-use-mcp-server.mjs", "utf8");
  const installation = await readFile("src/computer-use-installation.mjs", "utf8");
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const currentDocs = (await Promise.all([
    "README.md",
    "docs/productization/README.md",
    "docs/productization/roadmap.md",
    "docs/productization/release-gates.md",
    "docs/productization/real-release-pipeline-spec.md",
  ].map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(server, /asset-installer-host|createAssetRepairRuntime/iu);
  assert.doesNotMatch(installation, /WINDOWS_INSTALLER|ASSET_MANIFEST|ASSET_SIGNATURE|ASSET_TRUST_KEYRING/iu);
  assert.doesNotMatch(workflow, /azure|artifact-signing|authenticode|installer/iu);
  assert.doesNotMatch(currentDocs, /Windows installer|Azure Artifact Signing|blocked_unsigned/iu);
});
