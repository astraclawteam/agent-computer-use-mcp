import assert from "node:assert/strict";
import test from "node:test";

import { runAgentAttempt } from "../src/agent-e2e/attempt-runner.mjs";

test("attempt submits canonical prompt bytes and collects bound host evidence", async () => {
  const calls = [];
  const driver = recordingDriver(calls);
  const result = await runAgentAttempt({
    driver,
    lane: "codex",
    task: validTask(),
    packageIdentity: packageIdentity(),
    expectedModel: { provider: "openai", modelId: "codex-desktop-default" },
    scope: { processIds: [101] },
  });

  assert.deepEqual(calls, [
    "discover", "createSession", "configureMcp", "submitPrompt", "waitForTerminal",
    "collectEvidence", "close",
  ]);
  assert.equal(result.status, "passed");
  assert.equal(result.failureClass, null);
  assert.equal(result.hostIdentity.hostId, "codex");
  assert.equal(result.modelIdentity.modelId, "codex-desktop-default");
  assert.equal(result.mcpIdentity.core.sha256, "a".repeat(64));
});

test("attempt cancels and closes a host session on timeout", async () => {
  const calls = [];
  const driver = recordingDriver(calls, { wait: () => new Promise(() => {}) });
  const result = await runAgentAttempt({
    driver,
    lane: "codex",
    task: validTask({ timeoutMs: 10 }),
    packageIdentity: packageIdentity(),
    expectedModel: { provider: "openai", modelId: "codex-desktop-default" },
    scope: {},
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "infrastructure-failure");
  assert.equal(result.reason, "agent_e2e.host_timeout");
  assert.deepEqual(calls.slice(-2), ["cancel", "close"]);
});

test("attempt fails closed on model fallback", async () => {
  const driver = recordingDriver([], {
    evidence: {
      modelIdentity: { provider: "openai", modelId: "fallback-model" },
      mcpIdentity: packageIdentity(),
      transcript: [],
      mcpEvents: [],
    },
  });
  const result = await runAgentAttempt({
    driver,
    lane: "codex",
    task: validTask(),
    packageIdentity: packageIdentity(),
    expectedModel: { provider: "openai", modelId: "codex-desktop-default" },
    scope: {},
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "infrastructure-failure");
  assert.equal(result.reason, "agent_e2e.model_identity_mismatch");
});

test("attempt fails closed when the host did not use the released MCP package", async () => {
  const wrong = packageIdentity();
  wrong.core.sha256 = "f".repeat(64);
  const driver = recordingDriver([], {
    evidence: {
      modelIdentity: { provider: "openai", modelId: "codex-desktop-default" },
      mcpIdentity: wrong,
      transcript: [],
      mcpEvents: [],
    },
  });
  const result = await runAgentAttempt({
    driver,
    lane: "codex",
    task: validTask(),
    packageIdentity: packageIdentity(),
    expectedModel: { provider: "openai", modelId: "codex-desktop-default" },
    scope: {},
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "agent_e2e.mcp_identity_mismatch");
});

test("attempt preserves a terminal agent failure and still closes the host", async () => {
  const calls = [];
  const driver = recordingDriver(calls, {
    terminal: {
      status: "failed",
      failureClass: "perception-failure",
      reason: "agent_e2e.observation_insufficient",
    },
  });
  const result = await runAgentAttempt({
    driver,
    lane: "codex",
    task: validTask(),
    packageIdentity: packageIdentity(),
    expectedModel: { provider: "openai", modelId: "codex-desktop-default" },
    scope: {},
  });

  assert.equal(result.failureClass, "perception-failure");
  assert.equal(result.reason, "agent_e2e.observation_insufficient");
  assert.equal(calls.at(-1), "close");
});

function recordingDriver(calls, overrides = {}) {
  const evidence = overrides.evidence ?? {
    modelIdentity: { provider: "openai", modelId: "codex-desktop-default" },
    mcpIdentity: packageIdentity(),
    transcript: [{ role: "assistant", status: "completed" }],
    mcpEvents: [{ tool: "computer.capture", status: "passed" }],
  };
  return {
    async discover() {
      calls.push("discover");
      return { hostId: "codex", version: "26.707.3748.0" };
    },
    async createSession() {
      calls.push("createSession");
      return { sessionId: "session-1" };
    },
    async configureMcp(_session, configuration) {
      calls.push("configureMcp");
      if (configuration.scope.processIds) assert.equal(configuration.scope.processIds[0], 101);
    },
    async submitPrompt(_session, prompt) {
      calls.push("submitPrompt");
      assert.equal(Buffer.isBuffer(prompt), true);
      assert.equal(prompt.toString("utf8"), "Complete the synthetic task.\n");
    },
    async waitForTerminal() {
      calls.push("waitForTerminal");
      if (overrides.wait) return overrides.wait();
      return overrides.terminal ?? { status: "completed" };
    },
    async collectEvidence() {
      calls.push("collectEvidence");
      return evidence;
    },
    async cancel() {
      calls.push("cancel");
    },
    async close() {
      calls.push("close");
    },
  };
}

function validTask(overrides = {}) {
  return {
    goal: "Complete the synthetic task.\n",
    timeoutMs: 1_000,
    ...overrides,
  };
}

function packageIdentity() {
  return {
    core: { name: "agent-computer-use-mcp", version: "0.0.1", sha256: "a".repeat(64) },
    platform: { name: "agent-computer-use-mcp-win32-x64", version: "0.0.1", sha256: "b".repeat(64) },
  };
}
