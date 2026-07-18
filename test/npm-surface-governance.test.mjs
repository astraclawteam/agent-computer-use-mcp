import assert from "node:assert/strict";
import test from "node:test";
import { assertNoCutoverReleaseDefinition } from "../scripts/block-source-publish.mjs";
import { assertReleaseCutover } from "../scripts/release-npm-package.mjs";

test("Computer Use gate rejects a cut-over outgoing release definition", () => {
  assert.throws(() => assertNoCutoverReleaseDefinition([{ package: "agent-computer-use-mcp", cutover: true }]), /cut over.*release definition/);
});

test("actual artifact release gate rejects a cut-over definition and passes after removal", () => {
  const records = [{ package: "agent-computer-use-mcp", cutover: true }];
  assert.throws(() => assertReleaseCutover(records, true), /cut_over_definition_present/);
  assert.doesNotThrow(() => assertReleaseCutover(records, false));
});
