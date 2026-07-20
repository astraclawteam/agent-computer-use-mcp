import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertNoCutoverReleaseDefinition } from "../scripts/block-source-publish.mjs";
import { assertReleaseCutover, runNpmPackageRelease } from "../scripts/release-npm-package.mjs";

function retirement(packageName, overrides = {}) {
  return { package: packageName, replacement: null, message: "Retired.", effectiveDate: "2026-07-18", cutover: false, ...overrides };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "computer-use-npm-surface-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "agent-computer-use-mcp",
    private: true,
    scripts: { "release:npm:package": "node scripts/release-npm-package.mjs" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "scripts", "release-npm-package.mjs"), "export {};\n", "utf8");
  await writeFile(join(root, "src", "platform-package-contract.mjs"), "export const definition = true;\n", "utf8");
  return root;
}

test("Computer Use gate rejects a cut-over outgoing release definition", () => {
  assert.throws(() => assertNoCutoverReleaseDefinition([retirement("agent-computer-use-mcp", { cutover: true })]), /cut over.*release definition/);
});

test("actual artifact release gate rejects a cut-over definition and passes after removal", () => {
  const records = [retirement("agent-computer-use-mcp", { cutover: true })];
  assert.throws(() => assertReleaseCutover(records, true), /cut_over_definition_present/);
  assert.doesNotThrow(() => assertReleaseCutover(records, false));
});

test("Computer Use owner validates the exact five-field contract and duplicate packages", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const recordSets = [
    [{ ...retirement("agent-computer-use-mcp"), message: "", effectiveDate: "2026-02-30" }],
    [retirement("agent-computer-use-mcp"), retirement("agent-computer-use-mcp", { message: "Duplicate." })],
  ];
  for (const records of recordSets) {
    await writeFile(join(root, "npm-retirements.json"), `${JSON.stringify(records)}\n`, "utf8");
    let inspected = false;
    const operations = { inspect: async () => { inspected = true; return { name: "agent-computer-use-mcp", version: "1.0.0" }; } };
    await assert.rejects(runNpmPackageRelease(["--package", join(root, "package.tgz")], operations, { root }), /invalid retirement record|duplicate retirement record/i);
    assert.equal(inspected, false, "invalid policy must fail before release inspection or operations");
  }
});

test("actual Computer Use entrypoint rejects indirect release machinery before operations", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "npm-retirements.json"), `${JSON.stringify([retirement("agent-computer-use-mcp", { cutover: true })])}\n`, "utf8");
  let inspected = false;
  const operations = { inspect: async () => { inspected = true; return { name: "agent-computer-use-mcp", version: "1.0.0" }; } };

  await assert.rejects(runNpmPackageRelease(["--package", join(root, "package.tgz")], operations, { root }), /release:npm:package|cut_over_definition_present/i);
  assert.equal(inspected, false);
});

test("Computer Use governance passes after definition and release scripts are absent", async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "agent-computer-use-mcp", private: true, scripts: {} }, null, 2)}\n`, "utf8");
  await rm(join(root, "scripts", "release-npm-package.mjs"));
  await rm(join(root, "src", "platform-package-contract.mjs"));

  assert.doesNotThrow(() => assertNoCutoverReleaseDefinition([retirement("agent-computer-use-mcp", { cutover: true })], root));
});
