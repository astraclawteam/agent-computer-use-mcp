import assert from "node:assert/strict";
import test from "node:test";
import { assertNoCutoverReleaseDefinition } from "../scripts/block-source-publish.mjs";

test("Computer Use gate rejects a cut-over outgoing release definition", () => {
  assert.throws(() => assertNoCutoverReleaseDefinition([{ package: "agent-computer-use-mcp", cutover: true }]), /cut over.*release definition/);
});
