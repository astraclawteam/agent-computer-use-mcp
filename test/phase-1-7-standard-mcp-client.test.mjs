import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("Phase 1.7 uses the official MCP SDK client to connect over stdio", async () => {
  const client = new Client(
    { name: "agent-computer-use-standard-mcp-client-test", version: "0.0.1" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.equal(toolNames.includes("computer.health"), true);
    assert.equal(toolNames.includes("computer.installation"), true);

    const health = await client.callTool({
      name: "computer.health",
      arguments: { fast: true },
    });
    assert.equal(health.isError, false);
    assert.equal(health.structuredContent.module, "agent-computer-use-mcp");
    assert.equal(health.structuredContent.phases["1.7"], "standard-sdk-client-smoke");

    const installation = await client.callTool({
      name: "computer.installation",
      arguments: { client: "codex" },
    });
    assert.equal(installation.isError, false);
    assert.equal(installation.structuredContent.clientConfig.config.mcpServers["agent-computer-use"].command, process.execPath);
    assert.equal(installation.structuredContent.includeUserOverlay, false);
  } finally {
    await client.close();
  }
});

test("Phase 1.7 has an executable official MCP SDK client smoke script", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:1.7"], "node src/phase-1-7-standard-mcp-client.mjs");
  assert.equal(packageJson.dependencies["@modelcontextprotocol/sdk"], "^1.29.0");
});
