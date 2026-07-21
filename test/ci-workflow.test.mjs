import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("CI validates source MCP and Windows SEA without legacy npm or commercial release jobs", async () => {
  const source = await readFile(".github/workflows/ci.yml", "utf8");
  const workflow = parse(source);
  const runs = workflow.jobs.test.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /npm test/u);
  assert.match(runs, /phase:1\.6/u);
  assert.match(runs, /phase:1\.7/u);
  assert.match(runs, /phase:1\.8/u);
  assert.match(runs, /artifact:windows:build -- --skip-dotnet-build/u);
  assert.doesNotMatch(source, /npm publish|NODE_AUTH_TOKEN|commercial|soak|platform-release|\.zip/iu);
});
