import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ENVIRONMENT_ADAPTER_METHODS,
  assertEnvironmentAdapter,
  runEnvironmentLifecycle,
} from "../src/agent-e2e/environment-adapter.mjs";

test("environment adapter exposes setup verification and cleanup only", () => {
  assert.deepEqual(ENVIRONMENT_ADAPTER_METHODS, [
    "discover",
    "prepare",
    "launch",
    "verify",
    "cleanup",
  ]);
  assert.equal(assertEnvironmentAdapter(validAdapter()), true);
});

test("environment adapter rejects observation action and target-control workflows", () => {
  for (const method of [
    "observe",
    "act",
    "click",
    "type",
    "setValue",
    "navigate",
    "evaluate",
    "save",
    "closeDialog",
    "selectElement",
  ]) {
    assert.throws(
      () => assertEnvironmentAdapter({ ...validAdapter(), [method]() {} }),
      new RegExp(`agent_e2e\\.adapter_method_forbidden: ${method}`, "u"),
    );
  }
});

test("environment lifecycle gives the agent scope but no target action authority", async () => {
  const calls = [];
  const result = await runEnvironmentLifecycle(recordingAdapter(calls), { campaignId: "campaign-1" }, async (input) => {
    calls.push("agent");
    assert.deepEqual(input, {
      scope: { processIds: [101], windowScope: "owned-processes" },
      fixture: { workspaceId: "workspace-1" },
      app: { processIds: [101] },
    });
    assert.equal("mcp" in input, false);
    assert.equal("click" in input, false);
    return { terminalState: "completed", transcriptRef: "transcript-1" };
  });

  assert.deepEqual(calls, ["discover", "prepare", "launch", "agent", "verify", "cleanup"]);
  assert.equal(result.status, "passed");
  assert.equal(result.failureClass, null);
  assert.deepEqual(result.verification, { status: "passed", invariant: { kind: "file-bytes" } });
  assert.deepEqual(result.cleanup, { status: "passed", reason: null });
});

test("cleanup runs after agent failure and preserves its terminal class", async () => {
  const calls = [];
  const result = await runEnvironmentLifecycle(recordingAdapter(calls), {}, async () => {
    calls.push("agent");
    throw Object.assign(new Error("agent stopped"), {
      code: "agent_e2e.agent_stopped",
      failureClass: "agent-decision-failure",
    });
  });

  assert.deepEqual(calls, ["discover", "prepare", "launch", "agent", "cleanup"]);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "agent-decision-failure");
  assert.equal(result.reason, "agent_e2e.agent_stopped");
  assert.deepEqual(result.cleanup, { status: "passed", reason: null });
});

test("cleanup failure overrides an otherwise passing lifecycle", async () => {
  const adapter = recordingAdapter([]);
  adapter.cleanup = async () => {
    throw Object.assign(new Error("owned process remains"), { code: "agent_e2e.cleanup_process_remains" });
  };
  const result = await runEnvironmentLifecycle(adapter, {}, async () => ({ terminalState: "completed" }));

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "cleanup-failure");
  assert.equal(result.reason, "agent_e2e.cleanup_process_remains");
  assert.deepEqual(result.cleanup, { status: "failed", reason: "agent_e2e.cleanup_process_remains" });
});

test("product docs classify Phase 6 as harness evidence and installed apps as unqualified", async () => {
  const [matrix, roadmap] = await Promise.all([
    readFile("docs/productization/app-smoke-matrix.md", "utf8"),
    readFile("docs/productization/roadmap.md", "utf8"),
  ]);

  for (const source of [matrix, roadmap]) {
    assert.match(source, /Phase 6\.2[^\n]*(?:application )?harness/iu);
    assert.match(source, /not Agent E2E/iu);
    assert.match(source, /unqualified/iu);
  }
});

function validAdapter() {
  return {
    async discover() {},
    async prepare() {},
    async launch() {},
    async verify() {},
    async cleanup() {},
  };
}

function recordingAdapter(calls) {
  return {
    async discover() {
      calls.push("discover");
      return { scope: { processIds: [101], windowScope: "owned-processes" } };
    },
    async prepare() {
      calls.push("prepare");
      return { fixture: { workspaceId: "workspace-1" } };
    },
    async launch() {
      calls.push("launch");
      return { app: { processIds: [101] } };
    },
    async verify(_context, agentResult) {
      calls.push("verify");
      assert.equal(agentResult.terminalState, "completed");
      return { status: "passed", invariant: { kind: "file-bytes" } };
    },
    async cleanup() {
      calls.push("cleanup");
    },
  };
}
