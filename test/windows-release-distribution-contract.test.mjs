import assert from "node:assert/strict";
import { test } from "node:test";

import { releaseAssetNames } from "../src/platform-package-contract.mjs";

test("release distribution emits two npm packages and one complete Windows x64 ZIP", () => {
  const names = releaseAssetNames("0.0.1");

  assert.equal(names.filter((name) => name.endsWith(".tgz")).length, 2);
  assert.deepEqual(names.filter((name) => name.endsWith(".zip")), [
    "agent-computer-use-mcp-0.0.1-windows-x64.zip",
  ]);
  assert.equal(names.includes("checksums.txt"), true);
  assert.equal(names.includes("release-manifest.json"), true);
  assert.equal(names.includes("SBOM.cdx.json"), true);
  assert.equal(names.some((name) => /installer|setup|\.(?:exe|msi|msix)$/iu.test(name)), false);
});
