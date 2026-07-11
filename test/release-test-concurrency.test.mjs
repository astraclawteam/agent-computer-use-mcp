import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the release test gate runs serially so approval TTL and child-process checks are deterministic", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts.test, "node --test --test-concurrency=1");
});

