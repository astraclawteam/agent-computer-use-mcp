import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("release distribution keeps one npm package and gates the Windows x64 GitHub asset", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.name, "agent-computer-use-mcp");
  assert.equal(
    packageJson.scripts["release:windows:size-report"],
    "node scripts/windows-release-size-report.mjs",
  );

  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(
    ci,
    /run: npm run phase:0\.15[\s\S]*run: npm run release:windows:size-report/u,
  );

  const docs = await Promise.all([
    "README.md",
    "CHANGELOG.md",
    "docs/productization/roadmap.md",
    "docs/productization/real-release-pipeline-spec.md",
    "docs/productization/release-gates.md",
  ].map((path) => readFile(path, "utf8")));
  const combined = docs.join("\n");
  assert.match(combined, /one protected npm package/u);
  assert.match(combined, /Windows x64 only/u);
  assert.match(combined, /macOS and Linux[\s\S]*native validation/u);
  assert.match(combined, /310 MiB/u);
  assert.match(combined, /release:windows:size-report/u);
  assert.doesNotMatch(combined, /about 455 MB/u);
});
