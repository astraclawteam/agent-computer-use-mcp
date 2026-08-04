import assert from "node:assert/strict";
import { test } from "node:test";

import Ajv from "ajv";

import { callTool } from "../src/computer-use-mcp-server.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

/**
 * A tool whose failure result fails its own published outputSchema is worse than
 * a wrong status string: the official MCP SDK validates structuredContent before
 * handing it back, so the caller receives `-32602` and never sees the tool error
 * at all. Every terminal envelope this server can emit has to satisfy the schema
 * the same server advertises for that tool.
 */

// computer.installation never touches the router; an unsupported client is its
// own way of reaching the shared error envelope.
const ERROR_ARGUMENTS = {
  "computer.installation": { client: "definitely-not-a-supported-client" },
};

/** Any property access explodes, so a router-backed tool reaches the generic catch. */
function explodingRouter() {
  return new Proxy({}, {
    get(_target, property) {
      if (property === "then") return undefined;
      return async () => {
        throw new Error("controller.not_acquired: no lease");
      };
    },
  });
}

function validatorFor(name) {
  const tool = COMPUTER_USE_MCP_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(tool?.outputSchema, `${name} publishes an outputSchema`);
  return new Ajv({ strict: false }).compile(tool.outputSchema);
}

function assertMatchesSchema(name, structuredContent, label) {
  const validate = validatorFor(name);
  assert.equal(
    validate(structuredContent),
    true,
    `${name} ${label} must satisfy its own outputSchema: ${JSON.stringify(validate.errors)}`,
  );
}

async function failTool(name) {
  return callTool(
    explodingRouter(),
    name,
    ERROR_ARGUMENTS[name] ?? {},
    undefined,
    { toolSurface: "host" },
  );
}

test("the shared error envelope satisfies every tool's published outputSchema", async () => {
  // Captured from a real generic-catch result so the shape cannot drift away
  // from what callTool actually emits.
  const sample = (await failTool("computer.health")).structuredContent;
  assert.deepEqual(Object.keys(sample).sort(), [
    "error",
    "includeUserOverlay",
    "resultSchemaVersion",
    "status",
  ]);
  assert.equal(sample.status, "error");

  // Any tool can terminate this way: an unexpected internal throw, or a failure
  // while projecting media, returns this exact envelope regardless of the tool.
  for (const tool of COMPUTER_USE_MCP_TOOLS) {
    assertMatchesSchema(tool.name, sample, "shared error envelope");
  }
});

test("each tool's own failure path stays inside its published outputSchema", async (t) => {
  for (const tool of COMPUTER_USE_MCP_TOOLS) {
    await t.test(tool.name, async () => {
      const result = await failTool(tool.name);
      assert.ok(result.structuredContent.error?.code, `${tool.name} carries an error code`);
      assertMatchesSchema(tool.name, result.structuredContent, "failure result");
    });
  }
});

test("a constrained status enum admits the shared error envelope", () => {
  const constrained = COMPUTER_USE_MCP_TOOLS
    .filter((tool) => Array.isArray(tool.outputSchema?.properties?.status?.enum));

  assert.deepEqual(
    constrained.map((tool) => tool.name),
    ["computer.task", "computer.message", "computer.act"],
    "the set of tools with a constrained status is deliberate",
  );

  for (const tool of constrained) {
    const values = tool.outputSchema.properties.status.enum;
    assert.equal(values.includes("error"), true, `${tool.name} admits the error envelope status`);
    // Widening must not lose the real terminal outcomes.
    for (const outcome of ["committed", "not-applied", "indeterminate"]) {
      assert.equal(values.includes(outcome), true, `${tool.name} keeps ${outcome}`);
    }
  }
});

test("a constrained tool does not require its success fields on the error branch", () => {
  for (const name of ["computer.task", "computer.message", "computer.act"]) {
    const tool = COMPUTER_USE_MCP_TOOLS.find((candidate) => candidate.name === name);
    assert.deepEqual(
      tool.outputSchema.required,
      ["resultSchemaVersion", "includeUserOverlay"],
      `${name} keeps success fields on the allOf else-branch, not the top-level required list`,
    );
    assert.deepEqual(
      tool.outputSchema.allOf[0].then.required,
      ["status", "error"],
      `${name} requires only status and error once error is present`,
    );
  }
});

test("the shared error envelope is never relabelled as a successful or replay-safe outcome", async () => {
  // Everything reaching the generic envelope has already failed the safe-rejection
  // check, so it must not claim not-applied and invite a replay of a mutation that
  // may have landed.
  const result = await failTool("computer.act");
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, "error");
});

test("computer.task and computer.message report their own terminal failure, not the shared envelope", async () => {
  // These two own the whole lifecycle, so an argument rejection is a real
  // not-applied outcome with nothing delivered, released and elapsed reported.
  for (const name of ["computer.task", "computer.message"]) {
    const result = await failTool(name);
    assert.equal(result.isError, false, `${name} reports a terminal workflow result`);
    assert.equal(result.structuredContent.status, "not-applied");
    assert.equal(result.structuredContent.outcome, "not-applied");
    assert.equal(result.structuredContent.released, true, `${name} releases control on failure`);
    assert.equal(result.structuredContent.phase, "failed");
    assert.notEqual(result.structuredContent.status, "committed");
  }
});

test("computer.act keeps its safe-rejection envelope schema-valid", async () => {
  const router = {
    act: async () => {
      const error = new Error("action.observation_required: observe before acting");
      error.code = "action.observation_required";
      error.detail = { nextAction: "Call computer.observe first.", replaySafe: true };
      throw error;
    },
  };

  const result = await callTool(
    router,
    "computer.act",
    { action: { kind: "click", elementId: "element-1" } },
    undefined,
    { toolSurface: "host" },
  );

  assert.equal(result.isError, false, "a safe rejection is a normal result, not a tool error");
  assert.equal(result.structuredContent.status, "not-applied");
  assert.equal(result.structuredContent.result.applied, false);
  assert.equal(result.structuredContent.result.mayHaveSideEffects, false);
  assertMatchesSchema("computer.act", result.structuredContent, "safe-rejection envelope");
});

test("computer.observe keeps its step-budget envelope schema-valid", async () => {
  const budgetExhausted = () => {
    const error = new Error("observation.step_budget_exhausted: too many observations");
    error.code = "observation.step_budget_exhausted";
    error.detail = { observationCount: 6, observationLimit: 5 };
    throw error;
  };
  const router = { observe: async () => budgetExhausted(), capture: async () => budgetExhausted() };

  const result = await callTool(router, "computer.observe", { mode: "semantic" }, undefined, {
    toolSurface: "host",
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "blocked");
  assert.equal(result.structuredContent.executionControl.status, "blocked");
  assertMatchesSchema("computer.observe", result.structuredContent, "step-budget envelope");
});
