import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertNoCutoverReleaseDefinition, validateRetirementRecords } from "../scripts/block-source-publish.mjs";

const IDENTITIES = ["agent-computer-use-mcp", "@xiaozhiclaw/agent-computer-use-win32-x64"];

function staged(packageName) {
  return {
    package: packageName,
    replacement: null,
    message: "Install Computer Use from Hub through the XiaozhiClaw Runtime MCP Host.",
    effectiveDate: null,
    cutover: false,
  };
}

test("source blocker accepts only staged or effective five-field retirement rows", () => {
  assert.doesNotThrow(() => validateRetirementRecords(IDENTITIES.map(staged)));
  assert.doesNotThrow(() => validateRetirementRecords(IDENTITIES.map((name) => ({
    ...staged(name), effectiveDate: "2026-07-21", cutover: true,
  }))));
  assert.throws(() => validateRetirementRecords([{ ...staged(IDENTITIES[0]), cutover: true }]), /invalid retirement record/u);
});

test("Computer Use records both retired npm identities at the shared promotion date", async () => {
  const finalized = JSON.parse(await readFile(new URL("../npm-retirements.json", import.meta.url), "utf8"));
  assert.deepEqual(finalized.map(({ package: packageName }) => packageName), IDENTITIES);
  assert.equal(finalized.every(({ effectiveDate, cutover }) => effectiveDate === "2026-07-21" && cutover === true), true);
  assert.equal(existsSync(new URL("../scripts/finalize-npm-retirements.mjs", import.meta.url)), false);
  assert.doesNotThrow(() => assertNoCutoverReleaseDefinition(finalized));
});
