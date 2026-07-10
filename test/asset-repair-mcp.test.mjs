import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { test } from "node:test";

import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";
import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";

test("computer.repair schema exposes approval-bound asset operation lifecycle", () => {
  const repair = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.repair");
  assert.deepEqual(repair.inputSchema.properties.operation.enum, ["plan", "start", "status", "cancel"]);
  assert.equal(repair.inputSchema.properties.operationId.type, "string");
  assert.equal(repair.inputSchema.properties.requestApproval.type, "boolean");
  assert.equal(repair.inputSchema.properties.approvalToken.type, "string");
  assert.equal(repair.inputSchema.properties.approvalTtlMs.type, "number");
  assert.equal(repair.inputSchema.properties.allowNetwork.type, "boolean");
  assert.equal(repair.inputSchema.properties.timeoutMs.type, "number");
  assert.equal(Object.hasOwn(repair.inputSchema.properties, "keyringPath"), false);
  assert.equal(Object.hasOwn(repair.inputSchema.properties, "manifestPath"), false);
});

test("standard MCP client starts polls and cancels an approved asset repair", async () => {
  const calls = [];
  const operations = new Map();
  const assetOperationManager = {
    async start(options) {
      calls.push({ method: "start", options });
      const state = {
        status: "running",
        operationId: options.operationId,
        events: [{ seq: 0, state: "queued", percent: 0, terminal: false }],
        startsDesktopControl: false,
        includeUserOverlay: false,
      };
      operations.set(options.operationId, state);
      return state;
    },
    async status(operationId) {
      calls.push({ method: "status", operationId });
      return operations.get(operationId);
    },
    async cancel(operationId, reason) {
      calls.push({ method: "cancel", operationId, reason });
      const state = {
        ...operations.get(operationId),
        status: "cancelled",
        events: [{ seq: 1, state: "cancelled", percent: 0, terminal: true, reason }],
      };
      operations.set(operationId, state);
      return state;
    },
    async cancelAll(reason) {
      calls.push({ method: "cancelAll", reason });
      return [];
    },
    async close(reason) {
      calls.push({ method: "close", reason });
    },
  };
  const router = new ComputerUseProviderRouter({
    assetOperationManager,
    assetDeliveryConfig: {
      manifestPath: "C:\\ProgramData\\AgentComputerUse\\asset-manifest.json",
      signaturePath: "C:\\ProgramData\\AgentComputerUse\\asset-manifest.sig",
      keyringPath: "C:\\ProgramData\\AgentComputerUse\\asset-keyring.json",
      offlineRoot: "D:\\AgentComputerUseOffline",
    },
    installCacheDoctor: async () => fixtureDoctor(),
  });
  const { client, close } = await createMcpHarness(router);
  try {
    const requested = structured(await client.callTool({
      name: "computer.repair",
      arguments: {
        operation: "start",
        operationId: "asset-mcp-op",
        requestApproval: true,
        dryRun: false,
        actionIds: ["install-cua-driver-windows-x64"],
        allowNetwork: true,
      },
    }));
    assert.equal(requested.status, "approval_required");
    assert.equal(requested.approval.status, "pending");

    const started = structured(await client.callTool({
      name: "computer.repair",
      arguments: {
        operation: "start",
        operationId: "asset-mcp-op",
        approved: true,
        approvalToken: requested.approval.token,
        dryRun: false,
        actionIds: ["install-cua-driver-windows-x64"],
        allowNetwork: true,
      },
    }));
    assert.equal(started.status, "repair_started");
    assert.equal(started.mode, "asset-operation");
    assert.equal(started.execution.operation.status, "running");
    assert.equal(calls[0].options.allowNetwork, true);
    assert.equal(calls[0].options.manifestPath, router.assetDeliveryConfig.manifestPath);

    const polled = structured(await client.callTool({
      name: "computer.repair",
      arguments: { operation: "status", operationId: "asset-mcp-op" },
    }));
    assert.equal(polled.execution.operation.status, "running");

    const cancelled = structured(await client.callTool({
      name: "computer.repair",
      arguments: { operation: "cancel", operationId: "asset-mcp-op" },
    }));
    assert.equal(cancelled.status, "repair_cancelled");
    assert.equal(cancelled.execution.operation.status, "cancelled");
    assert.equal(cancelled.startsDesktopControl, false);
    assert.equal(cancelled.includeUserOverlay, false);
  } finally {
    await close();
  }
});

test("repair approval rejects network permission escalation", async () => {
  let starts = 0;
  const router = new ComputerUseProviderRouter({
    assetOperationManager: {
      async start() { starts += 1; return { status: "running", operationId: "asset-no-escalation" }; },
      async close() {},
      async cancelAll() { return []; },
    },
    assetDeliveryConfig: { manifestPath: "m", signaturePath: "s", keyringPath: "k", offlineRoot: "o" },
    installCacheDoctor: async () => fixtureDoctor(),
  });
  const requested = await router.repair({
    operation: "start",
    operationId: "asset-no-escalation",
    requestApproval: true,
    dryRun: false,
    actionIds: ["install-cua-driver-windows-x64"],
    allowNetwork: false,
  });

  const escalated = await router.repair({
    operation: "start",
    operationId: "asset-no-escalation",
    approved: true,
    approvalToken: requested.approval.token,
    dryRun: false,
    actionIds: ["install-cua-driver-windows-x64"],
    allowNetwork: true,
  });

  assert.equal(escalated.status, "approval_invalid");
  assert.equal(starts, 0);
  await router.close();
});

function fixtureDoctor() {
  return {
    status: "degraded",
    layout: {},
    assets: [],
    permissions: { status: "healthy" },
    repairPlan: {
      mode: "plan-only",
      requiresApproval: true,
      actions: [
        {
          id: "install-cua-driver-windows-x64",
          kind: "driver",
          target: "configured-by-host",
          reason: "missing",
          executesImmediately: false,
        },
      ],
    },
    repairCatalog: { entries: [] },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

async function createMcpHarness(router) {
  const server = new Server({ name: "asset-repair-test", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: COMPUTER_USE_MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const value = await router.repair(request.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      isError: false,
    };
  });
  const client = new Client({ name: "asset-repair-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
      await router.close();
    },
  };
}

function structured(result) {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
