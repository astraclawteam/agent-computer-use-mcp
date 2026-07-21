import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { assertNoCutoverReleaseDefinition, validateRetirementRecords } from "../scripts/block-source-publish.mjs";

const IDENTITIES = ["agent-computer-use-mcp", "@xiaozhiclaw/agent-computer-use-win32-x64"];
const finalizerUrl = new URL("../scripts/finalize-npm-retirements.mjs", import.meta.url);

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

test("Computer Use retirement finalizer preflights, applies once, and rejects a different date", async (t) => {
  assert.equal(existsSync(finalizerUrl), true, "Computer Use retirement finalizer must exist");
  const { finalizeComputerUseNpmRetirements } = await import(finalizerUrl.href);
  const root = await mkdtemp(join(tmpdir(), "computer-use-retirement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "agent-computer-use-mcp",
    private: true,
    scripts: { prepublishOnly: "node scripts/block-source-publish.mjs" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "scripts", "block-source-publish.mjs"), "process.exitCode = 1;\n", "utf8");
  await writeFile(join(root, "npm-retirements.json"), `${JSON.stringify(IDENTITIES.map(staged), null, 2)}\n`, "utf8");
  const before = await readFile(join(root, "npm-retirements.json"), "utf8");

  assert.deepEqual(await finalizeComputerUseNpmRetirements({ repoRoot: root, promotionDate: "2026-07-21", apply: false }), {
    applied: false, packages: IDENTITIES, promotionDate: "2026-07-21",
  });
  assert.equal(await readFile(join(root, "npm-retirements.json"), "utf8"), before);
  assert.equal((await finalizeComputerUseNpmRetirements({ repoRoot: root, promotionDate: "2026-07-21", apply: true })).applied, true);
  assert.equal((await finalizeComputerUseNpmRetirements({ repoRoot: root, promotionDate: "2026-07-21", apply: true })).applied, false);
  await assert.rejects(
    finalizeComputerUseNpmRetirements({ repoRoot: root, promotionDate: "2026-07-22", apply: true }),
    /different promotion date/u,
  );
  const finalized = JSON.parse(await readFile(join(root, "npm-retirements.json"), "utf8"));
  assert.doesNotThrow(() => assertNoCutoverReleaseDefinition(finalized, root));
});
