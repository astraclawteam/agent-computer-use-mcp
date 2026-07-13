import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("runtime soak operations freeze commands resources retention and evidence handling", async () => {
  const operations = await readFile("docs/productization/runtime-soak-operations.md", "utf8");
  const gates = await readFile("docs/productization/release-gates.md", "utf8");
  const index = await readFile("docs/productization/README.md", "utf8");

  assert.match(operations, /7,200,000 ms/u);
  assert.match(operations, /28,800,000 ms/u);
  assert.match(operations, /npm run phase:8\.0 -- --gate nightly --duration-ms 7200000 --evidence-root evidence\/nightly --seed 20260713/u);
  assert.match(operations, /npm run soak:rc/u);
  assert.match(operations, /npm run soak:rc:verify -- <evidence-directory>/u);
  assert.match(operations, /128 MiB/u);
  assert.match(operations, /128 handles/u);
  assert.match(operations, /below 0\.1%/u);
  assert.match(operations, /zero orphan processes, residual ports, overlay leaks, and cursor leaks/iu);
  assert.match(operations, /5 GiB/u);
  assert.match(operations, /10 GiB/u);
  assert.match(operations, /AC power|plugged in/iu);
  assert.match(operations, /sleep.*Never|disable automatic sleep/iu);
  assert.match(operations, /Windows Update/iu);
  assert.match(operations, /pending reboot/iu);
  assert.match(operations, /never delete or overwrite/iu);
  assert.match(operations, /Do not edit `report\.json`, `events\.jsonl`, `run-manifest\.json`, or `checksums\.txt`/u);
  assert.match(operations, /new run ID/iu);
  assert.match(operations, /screenshots.*forbidden/iu);
  assert.match(gates, /two-hour nightly/u);
  assert.match(gates, /eight-hour release-candidate/u);
  assert.match(index, /runtime-soak-operations\.md/u);
});
