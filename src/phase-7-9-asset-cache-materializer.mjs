import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAssetInstallerExecutor } from "./asset-installer-host.mjs";
import { inspectActiveAssetEntryPoint } from "./active-asset-state.mjs";
import { AssetOperationManager } from "./asset-operation-manager.mjs";
import { createPhaseDriverFixture, createPhaseSignedFixture } from "./asset-phase-fixture.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "./computer-use-mcp-tools.mjs";
import { ComputerUseProviderRouter } from "./computer-use-provider-router.mjs";
import { ensureWindowsInstallerPublished, runWindowsInstaller } from "./windows-installer-host.mjs";

const root = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-7-9-"));
let assetServer;
let mcpHarness;
let nativeInstallerPath;

try {
  nativeInstallerPath = (await ensureWindowsInstallerPublished()).exePath;
  const main = roots(root, "main");
  const v1 = await createPhaseDriverFixture({ root, fixtureId: "v1", version: "0.7.1", releaseId: "assets-v1" });
  const v2 = await createPhaseDriverFixture({ root, fixtureId: "v2", version: "0.7.2", releaseId: "assets-v2" });

  const verified = await execute("asset-verify-manifest", main, v1);
  const preparedV1 = await execute("asset-prepare", main, v1);
  await execute("asset-activate", main, v1);
  const preparedV2 = await execute("asset-prepare", main, v2);

  await writeFile(preparedV2.assets[0].entryPoint, "tampered", "utf8");
  const rejectedActivation = await execute("asset-activate", main, v2, { expectedExitCode: 2 });
  const stateAfterRejectedActivation = await execute("asset-status", main, v2);
  const activationAtomic = rejectedActivation.status === "failed"
    && stateAfterRejectedActivation.currentReleaseId === "assets-v1";
  await writeFile(preparedV2.assets[0].entryPoint, v2.driverBytes);
  await execute("asset-activate", main, v2);
  const rolledBack = await execute("asset-rollback", main, v2);
  const activeDriverResolution = inspectActiveAssetEntryPoint("cua-driver-windows-x64", {
    programRoot: main.programRoot,
  });
  const runtimeResolvedActiveDriver = activeDriverResolution.status === "ready";

  const corrupt = await createPhaseDriverFixture({ root, fixtureId: "corrupt", version: "0.7.3", releaseId: "assets-corrupt" });
  const corruptBytes = Buffer.from(await readFile(corrupt.offlineBlobPath));
  corruptBytes[0] ^= 0xff;
  await writeFile(corrupt.offlineBlobPath, corruptBytes);
  const corruptResult = await execute("asset-prepare", roots(root, "corrupt-roots"), corrupt, { expectedExitCode: 2 });

  const traversal = await createPhaseDriverFixture({
    root,
    fixtureId: "traversal",
    version: "0.7.4",
    releaseId: "assets-traversal",
    archiveEntries: [
      { path: "cua-driver/cua-driver.exe", contentsBase64: Buffer.from("driver-0.7.4").toString("base64") },
      { path: "cua-driver/cua-driver-uia.exe", contentsBase64: Buffer.from("uia-0.7.4").toString("base64") },
      { path: "../escape.txt", contentsBase64: Buffer.from("escape").toString("base64") },
    ],
  });
  const traversalResult = await execute("asset-prepare", roots(root, "traversal-roots"), traversal, { expectedExitCode: 2 });

  assetServer = await createInterruptingAssetServer(v2.zipBytes);
  const networkAsset = {
    ...v2.asset,
    source: { ...v2.asset.source, urls: [assetServer.url] },
  };
  const network = {
    ...await createPhaseSignedFixture({
      root: join(root, "network"),
      releaseId: "assets-network",
      asset: networkAsset,
    }),
    asset: networkAsset,
    offlineRoot: join(root, "network", "empty-offline"),
  };
  await mkdir(network.offlineRoot, { recursive: true });
  const networkRoots = roots(root, "network-roots");
  await execute("asset-prepare", networkRoots, network, { expectedExitCode: 2, allowNetwork: true });
  const resumed = await execute("asset-prepare", networkRoots, network, { allowNetwork: true });
  const offlineBlob = cacheBlobPath(main.programRoot, v2.archiveSha256);
  const networkBlob = cacheBlobPath(networkRoots.programRoot, v2.archiveSha256);
  const offlineCacheKeyMatchesHttp = (await readFile(offlineBlob)).equals(await readFile(networkBlob));

  const mcpFixture = await createPhaseDriverFixture({ root, fixtureId: "mcp", version: "0.7.5", releaseId: "assets-mcp" });
  const mcpRoots = roots(root, "mcp-roots");
  const manager = new AssetOperationManager({
    stateRoot: join(mcpRoots.dataRoot, "runtime", "asset-operations"),
    executor: createAssetInstallerExecutor(mcpRoots),
  });
  const router = new ComputerUseProviderRouter({
    assetOperationManager: manager,
    assetDeliveryConfig: {
      manifestPath: mcpFixture.manifestPath,
      signaturePath: mcpFixture.signaturePath,
      keyringPath: mcpFixture.keyringPath,
      offlineRoot: mcpFixture.offlineRoot,
    },
    installCacheDoctor: async () => repairDoctor(),
  });
  mcpHarness = await createMcpHarness(router);
  const requestCountBeforeEnable = assetServer.requests.length;
  await router.health({ fast: true });
  const firstEnableDownloadCount = assetServer.requests.length - requestCountBeforeEnable;
  const mcpRepairVerified = await runMcpRepair(mcpHarness.client);

  const report = {
    status: "passed",
    phase: "7.9",
    benchmark: "trusted-asset-cache-materializer",
    installerKind: "native-aot",
    manifestVerified: verified.status === "verified",
    offlineCacheKeyMatchesHttp,
    resumeUsed: resumed.resumeUsed === true && assetServer.requests.some((request) => request.range),
    corruptBlobRejected: corruptResult.error?.code === "asset.download_hash_mismatch",
    zipTraversalRejected: traversalResult.error?.code === "asset.archive_path_invalid",
    activationAtomic,
    rollbackVerified: rolledBack.currentReleaseId === "assets-v1" && rolledBack.previousReleaseId === "assets-v2",
    mcpRepairVerified,
    runtimeResolvedActiveDriver,
    activeDriverResolutionReason: activeDriverResolution.reason ?? "ready",
    firstEnableDownloadCount,
    startsDesktopControl: false,
    includeUserOverlay: false,
  };
  report.status = Object.entries(report)
    .filter(([key]) => !["status", "phase", "benchmark", "installerKind", "activeDriverResolutionReason", "firstEnableDownloadCount", "startsDesktopControl", "includeUserOverlay"].includes(key))
    .every(([, value]) => value === true)
    && firstEnableDownloadCount === 0 ? "passed" : "failed";
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "failed",
    phase: "7.9",
    benchmark: "trusted-asset-cache-materializer",
    installerKind: "native-aot",
    error: error instanceof Error ? error.message : String(error),
    firstEnableDownloadCount: 0,
    startsDesktopControl: false,
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await mcpHarness?.close().catch(() => {});
  await assetServer?.close().catch(() => {});
  await rm(root, { recursive: true, force: true });
}

function roots(base, name) {
  return {
    programRoot: join(base, name, "program"),
    dataRoot: join(base, name, "data"),
    installerPath: nativeInstallerPath,
  };
}

async function execute(operation, installRoots, fixture, options = {}) {
  const result = await runWindowsInstaller(operation, {
    ...installRoots,
    manifestPath: fixture.manifestPath,
    signaturePath: fixture.signaturePath,
    keyringPath: fixture.keyringPath,
    offlineRoot: fixture.offlineRoot,
    assetIds: fixture.asset ? [fixture.asset.id] : undefined,
    releaseId: fixture.manifest?.releaseId,
    operationId: `phase-7-9-${operation}-${fixture.manifest?.releaseId ?? "verify"}`,
    allowNetwork: options.allowNetwork === true,
    env: { AGENT_COMPUTER_USE_TEST_ALLOW_PRIVATE_NETWORK: "1" },
  });
  if (result.exitCode !== (options.expectedExitCode ?? 0)) {
    throw new Error(`phase-7-9.${operation}_failed: ${result.stderr || result.stdout}`);
  }
  return result.report;
}

function cacheBlobPath(programRoot, sha256) {
  return join(programRoot, "cache", "assets", "sha256", sha256.slice(0, 2), sha256, "blob");
}

async function createInterruptingAssetServer(blob) {
  const requests = [];
  let interrupted = false;
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    requests.push({ range, ifRange: request.headers["if-range"] ?? null });
    if (!interrupted && !range) {
      interrupted = true;
      const partial = blob.subarray(0, Math.floor(blob.length / 3));
      response.writeHead(200, { "Accept-Ranges": "bytes", "Content-Length": partial.length, ETag: '"phase-7-9"' });
      response.end(partial);
      return;
    }
    const match = /^bytes=(\d+)-$/.exec(range ?? "");
    const start = match ? Number(match[1]) : 0;
    const body = blob.subarray(start);
    const status = match ? 206 : 200;
    const headers = { "Accept-Ranges": "bytes", "Content-Length": body.length, ETag: '"phase-7-9"' };
    if (match) headers["Content-Range"] = `bytes ${start}-${blob.length - 1}/${blob.length}`;
    response.writeHead(status, headers);
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/asset.zip`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function repairDoctor() {
  return {
    status: "degraded",
    layout: {},
    assets: [],
    permissions: { status: "healthy" },
    repairPlan: {
      mode: "plan-only",
      requiresApproval: true,
      actions: [{
        id: "install-cua-driver-windows-x64",
        kind: "driver",
        reason: "missing",
        executesImmediately: false,
      }],
    },
    repairCatalog: { entries: [] },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

async function createMcpHarness(router) {
  const server = new Server({ name: "phase-7-9-server", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: COMPUTER_USE_MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const value = await router.repair(request.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false };
  });
  const client = new Client({ name: "phase-7-9-client", version: "1.0.0" });
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

async function runMcpRepair(client) {
  const requested = structured(await client.callTool({
    name: "computer.repair",
    arguments: {
      operation: "start",
      operationId: "phase-7-9-mcp-repair",
      requestApproval: true,
      dryRun: false,
      actionIds: ["install-cua-driver-windows-x64"],
      allowNetwork: false,
    },
  }));
  const started = structured(await client.callTool({
    name: "computer.repair",
    arguments: {
      operation: "start",
      operationId: "phase-7-9-mcp-repair",
      approved: true,
      approvalToken: requested.approval.token,
      dryRun: false,
      actionIds: ["install-cua-driver-windows-x64"],
      allowNetwork: false,
    },
  }));
  if (started.status !== "repair_started") return false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = structured(await client.callTool({
      name: "computer.repair",
      arguments: { operation: "status", operationId: "phase-7-9-mcp-repair" },
    }));
    if (state.execution.operation.status === "completed") {
      return state.execution.operation.result?.status === "activated"
        && state.startsDesktopControl === false
        && state.includeUserOverlay === false;
    }
    if (["failed", "cancelled", "timed_out"].includes(state.execution.operation.status)) return false;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function structured(result) {
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
