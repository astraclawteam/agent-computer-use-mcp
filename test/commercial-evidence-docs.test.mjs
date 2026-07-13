import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("product docs freeze PR soak evidence commands targets and privacy", async () => {
  const readme = await readFile("README.md", "utf8");
  const gates = await readFile("docs/productization/release-gates.md", "utf8");
  const roadmap = await readFile("docs/productization/roadmap.md", "utf8");
  const text = `${readme}\n${gates}\n${roadmap}`;

  assert.match(text, /npm run soak:pr/u);
  assert.match(text, /npm run evidence:verify -- <evidence-directory>/u);
  assert.match(text, /900,000 ms/u);
  assert.match(text, /128 MiB/u);
  assert.match(text, /128 handles/u);
  assert.match(text, /below 0\.1%/u);
  assert.match(text, /run-manifest\.json/u);
  assert.match(text, /events\.jsonl/u);
  assert.match(text, /report\.json/u);
  assert.match(text, /checksums\.txt/u);
  assert.match(text, /zero orphan processes,\s+residual ports, overlay leaks, and cursor\s+leaks/u);
  assert.match(text, /complete screenshots and user documents are forbidden/iu);
  assert.match(roadmap, /two-hour nightly and eight-hour release-candidate evidence remain in PR6B/iu);
});
