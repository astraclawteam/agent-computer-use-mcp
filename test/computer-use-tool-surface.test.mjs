import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { callTool } from "../src/computer-use-mcp-server.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";
import {
  assertToolOnSurface,
  hostToolSurfaceArgs,
  hostToolSurfaceEnv,
  isToolOnSurface,
  listToolsForSurface,
  resolveToolSurface,
} from "../src/computer-use-tool-surface.mjs";

const HOST_ONLY_TOOLS = [
  "computer.acquire",
  "computer.observe",
  "computer.act",
  "computer.release",
  "computer.health",
  "computer.doctor",
  "computer.installation",
  "computer.repair",
];

test("the Agent surface is the fail-closed default for any launch", () => {
  assert.deepEqual(resolveToolSurface({ argv: [], env: {} }), {
    surface: "agent",
    source: "default",
  });
  assert.deepEqual(
    resolveToolSurface({ argv: [process.execPath, "src/computer-use-mcp-server.mjs"], env: {} }),
    { surface: "agent", source: "default" },
  );
});

test("only a launch-owned signal selects the host surface", () => {
  const launches = [
    { argv: ["--tool-surface=host"], env: {} },
    { argv: ["--tool-surface", "host"], env: {} },
    { argv: ["--tool-surface=HOST"], env: {} },
  ];
  for (const launch of launches) {
    assert.deepEqual(resolveToolSurface(launch), { surface: "host", source: "argv" });
  }

  assert.deepEqual(
    resolveToolSurface({ argv: [], env: { AGENT_COMPUTER_USE_TOOL_SURFACE: "host" } }),
    { surface: "host", source: "environment" },
  );
  assert.deepEqual(
    resolveToolSurface({ argv: [], env: { XIAOZHICLAW_TOOL_SURFACE: "host" } }),
    { surface: "host", source: "environment" },
  );
});

test("the retired host-control flag cannot reopen the Host surface", () => {
  assert.deepEqual(resolveToolSurface({ argv: ["--host-control"], env: {} }), {
    surface: "agent",
    source: "default",
  });
});

test("launch arguments outrank inherited environment", () => {
  assert.deepEqual(
    resolveToolSurface({
      argv: ["--tool-surface=agent"],
      env: { AGENT_COMPUTER_USE_TOOL_SURFACE: "host" },
    }),
    { surface: "agent", source: "argv" },
  );
});

test("an unknown surface fails loudly instead of degrading to a working launch", () => {
  assert.throws(
    () => resolveToolSurface({ argv: ["--tool-surface=admin"], env: {} }),
    (error) => {
      assert.equal(error.code, "tool_surface.invalid");
      assert.equal(error.detail.requested, "admin");
      assert.deepEqual(error.detail.supported, ["agent", "host"]);
      return true;
    },
  );
  assert.throws(
    () => resolveToolSurface({ argv: [], env: { AGENT_COMPUTER_USE_TOOL_SURFACE: "everything" } }),
    { code: "tool_surface.invalid" },
  );
});

test("the advertised inventory, not a private _meta key, carries the boundary", () => {
  assert.deepEqual(
    listToolsForSurface("agent").map((tool) => tool.name),
    ["computer.task", "computer.message"],
  );
  assert.deepEqual(
    listToolsForSurface("host").map((tool) => tool.name),
    COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name),
  );

  for (const name of HOST_ONLY_TOOLS) {
    assert.equal(isToolOnSurface("agent", name), false, `${name} stays off the Agent surface`);
    assert.equal(isToolOnSurface("host", name), true, `${name} stays on the host surface`);
  }

  // A Host that still reads the compatibility key must see the same answer the
  // advertised inventory already gives it.
  assert.deepEqual(
    COMPUTER_USE_MCP_TOOLS
      .filter((tool) => tool._meta?.["xiaozhiclaw/visibility"] === "host")
      .map((tool) => tool.name),
    HOST_ONLY_TOOLS,
  );
});

test("an off-surface tool is indistinguishable from a tool that does not exist", () => {
  for (const name of HOST_ONLY_TOOLS) {
    assert.throws(
      () => assertToolOnSurface("agent", name),
      (error) => {
        assert.equal(error.code, "tool_not_found");
        assert.equal(error.message, `tool_not_found: ${name}`);
        assert.equal(error.detail, undefined, "no detail may hint that the name is real");
        return true;
      },
    );
  }
  assert.doesNotThrow(() => assertToolOnSurface("agent", "computer.task"));
  assert.doesNotThrow(() => assertToolOnSurface("agent", "computer.message"));
});

test("tools/call refuses a host tool on the Agent surface without reaching the router", async () => {
  const router = new Proxy({}, {
    get() {
      throw new Error("the router must not be reached for an off-surface tool");
    },
  });

  for (const name of ["computer.act", "computer.repair", "computer.acquire"]) {
    const result = await callTool(router, name, {}, undefined, { toolSurface: "agent" });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, "tool_not_found");
    assert.equal(result.structuredContent.error.message, `tool_not_found: ${name}`);
  }

  const unknown = await callTool(router, "computer.nonexistent", {}, undefined, { toolSurface: "agent" });
  const hidden = await callTool(router, "computer.nonexistent", {}, undefined, { toolSurface: "host" });
  assert.deepEqual(unknown.structuredContent, hidden.structuredContent);
});

test("callTool keeps the full surface for in-process Host callers", async () => {
  let doctorCalls = 0;
  const router = { doctor: async () => { doctorCalls += 1; return { status: "healthy" }; } };
  const result = await callTool(router, "computer.doctor", { fast: true }, undefined, { toolSurface: "host" });
  assert.equal(result.isError, false);
  assert.equal(doctorCalls, 1);
});

test("a standard MCP Host receives only the Agent surface over real stdio", async () => {
  const client = new Client({ name: "tool-surface-default", version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["computer.task", "computer.message"]);

    // Knowing the name is not enough; the gate is on the call, not the listing.
    for (const name of ["computer.act", "computer.repair"]) {
      const result = await client.callTool({ name, arguments: {} });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, "tool_not_found");
    }
  } finally {
    await client.close();
  }
});

test("a Host that opts in over real stdio receives the full surface", async () => {
  const client = new Client({ name: "tool-surface-host", version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs", ...hostToolSurfaceArgs()],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name),
    );
  } finally {
    await client.close();
  }
});

test("a Host that cannot set launch arguments can opt in through the public environment name", async () => {
  const client = new Client({ name: "tool-surface-host-env", version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
    env: { ...process.env, ...hostToolSurfaceEnv() },
  });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, COMPUTER_USE_MCP_TOOLS.length);
  } finally {
    await client.close();
  }
});
