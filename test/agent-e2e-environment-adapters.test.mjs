import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertEnvironmentAdapter, runEnvironmentLifecycle } from "../src/agent-e2e/environment-adapter.mjs";
import {
  REGISTERED_ENVIRONMENT_ADAPTER_IDS,
  createRegisteredEnvironmentAdapter,
} from "../src/agent-e2e/environment-adapters/index.mjs";

test("registered qualification adapters preserve the environment-only lifecycle", async () => {
  for (const adapterId of REGISTERED_ENVIRONMENT_ADAPTER_IDS) {
    const calls = [];
    const adapter = createRegisteredEnvironmentAdapter(adapterId, operations(calls));
    assert.equal(assertEnvironmentAdapter(adapter), true);
    const result = await runEnvironmentLifecycle(adapter, {}, async () => ({ terminalState: "completed" }));
    assert.equal(result.status, "passed", adapterId);
    assert.deepEqual(calls, ["discover", "prepare", "launch", "verify", "cleanup"]);
  }
});

test("qualification adapter registry rejects action-capable operations", () => {
  assert.throws(
    () => createRegisteredEnvironmentAdapter("temporary-text-document", { ...operations([]), click() {} }),
    /agent_e2e\.adapter_operation_forbidden: click/u,
  );
});

test("qualification environment adapter source contains no target automation client", async () => {
  const source = await readFile("src/agent-e2e/environment-adapters/index.mjs", "utf8");
  assert.doesNotMatch(source, /CuaDriver|McpClient|computer\.action|computer\.capture|coordinates|menuPath|closeDialog/iu);
});

function operations(calls) {
  return {
    async discover() { calls.push("discover"); return { scope: { windowScope: "owned-processes" } }; },
    async prepare() { calls.push("prepare"); return { fixture: { workspaceId: "temporary" } }; },
    async launch() { calls.push("launch"); return { app: { processIds: [1] } }; },
    async verify() { calls.push("verify"); return { status: "passed", invariant: { kind: "synthetic-state" } }; },
    async cleanup() { calls.push("cleanup"); },
  };
}
