import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("nightly perception verifies the locked pack and retains only sealed evidence", async () => {
  const workflow = await readFile(".github/workflows/nightly-perception.yml", "utf8");

  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /self-hosted[\s\S]*windows[\s\S]*computer-use-app-lab/u);
  assert.match(workflow, /AGENT_COMPUTER_USE_PERCEPTION_CORPUS:[\s\S]*PERCEPTION_CORPUS_ROOT/u);
  assert.match(workflow, /verify-perception-corpus\.mjs[\s\S]*perception-corpus\.lock\.json/u);
  assert.match(workflow, /npm run perception:full/u);
  assert.match(workflow, /--evidence-root evidence\/perception/u);
  assert.match(workflow, /if:\s*(?:\$\{\{\s*)?always\(\)/u);
  assert.match(workflow, /run-manifest\.json/u);
  assert.match(workflow, /events\.jsonl/u);
  assert.match(workflow, /report\.json/u);
  assert.match(workflow, /checksums\.txt/u);
  assert.doesNotMatch(workflow, /\*\*\/\*\.png|perception-corpus\/\*\*/u);
  assert.match(workflow, /retention-days:\s*30/u);
});

test("perception workflow is not part of release or ordinary PR publishing", async () => {
  const release = await readFile(".github/workflows/release.yml", "utf8");
  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  assert.doesNotMatch(release, /nightly-perception|perception:full/u);
  assert.doesNotMatch(ci, /nightly-perception|perception:full/u);
});
