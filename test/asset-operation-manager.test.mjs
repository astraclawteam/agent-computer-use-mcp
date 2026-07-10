import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { AssetOperationManager } from "../src/asset-operation-manager.mjs";

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("asset operation starts reports progress and persists completion", async () => {
  const stateRoot = await fixtureRoot();
  const manager = new AssetOperationManager({
    stateRoot,
    executor: async (options, context) => {
      await context.onEvent({ state: "downloading", percent: 40, assetId: options.actionIds[0] });
      await context.onEvent({ state: "verifying", percent: 80, localPath: "C:\\Users\\demo\\asset.zip" });
      return { status: "activated", currentReleaseId: "assets-v1" };
    },
  });

  const started = await manager.start({
    operationId: "asset-op-1",
    actionIds: ["install-cua-driver-windows-x64"],
    allowNetwork: false,
  });
  assert.equal(started.status, "running");
  const completed = await waitForTerminal(manager, "asset-op-1");

  assert.equal(completed.status, "completed");
  assert.equal(completed.result.currentReleaseId, "assets-v1");
  assert.equal(completed.events.at(-1).state, "complete");
  assert.equal(completed.events.at(-1).terminal, true);
  assert.equal(completed.events.some((event) => event.localPath === "C:\\Users\\[USER]\\asset.zip"), true);
  assert.equal(completed.startsDesktopControl, false);
  assert.equal(completed.includeUserOverlay, false);

  const persisted = JSON.parse(await readFile(join(stateRoot, "asset-op-1.json"), "utf8"));
  assert.equal(persisted.status, "completed");
  const reloaded = await new AssetOperationManager({ stateRoot, executor: async () => ({}) }).status("asset-op-1");
  assert.equal(reloaded.status, "completed");
});

test("asset operation cancellation aborts execution and records a terminal event", async () => {
  const stateRoot = await fixtureRoot();
  const manager = new AssetOperationManager({
    stateRoot,
    executor: async (_options, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    }),
  });
  await manager.start({
    operationId: "asset-op-2",
    actionIds: ["cache-ocr-model-pp-ocrv6-small"],
  });

  const cancelled = await manager.cancel("asset-op-2", "user-requested");

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.events.at(-1).state, "cancelled");
  assert.equal(cancelled.events.at(-1).reason, "user-requested");
  assert.equal(cancelled.events.at(-1).terminal, true);
});

test("duplicate starts are idempotent and a second activation is rejected", async () => {
  const stateRoot = await fixtureRoot();
  const manager = new AssetOperationManager({
    stateRoot,
    executor: async (_options, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    }),
  });
  const first = await manager.start({ operationId: "asset-op-3", actionIds: ["install-cua-driver-windows-x64"] });
  const duplicate = await manager.start({ operationId: "asset-op-3", actionIds: ["install-cua-driver-windows-x64"] });

  assert.equal(duplicate.operationId, first.operationId);
  assert.equal(duplicate.startedAt, first.startedAt);
  await assert.rejects(
    () => manager.start({ operationId: "asset-op-4", actionIds: ["install-webview2-runtime"] }),
    /asset\.operation_conflict/,
  );
  await manager.cancel("asset-op-3", "test-cleanup");
});

test("asset operation timeout fails closed and network permission is explicit", async () => {
  const stateRoot = await fixtureRoot();
  let observedAllowNetwork;
  const manager = new AssetOperationManager({
    stateRoot,
    executor: async (options, context) => {
      observedAllowNetwork = options.allowNetwork;
      return new Promise((resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    },
  });
  await manager.start({
    operationId: "asset-op-5",
    actionIds: ["install-cua-driver-windows-x64"],
    timeoutMs: 25,
  });

  const timedOut = await waitForTerminal(manager, "asset-op-5");

  assert.equal(observedAllowNetwork, false);
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.events.at(-1).state, "timed_out");
  assert.equal(timedOut.events.at(-1).terminal, true);
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-asset-operations-"));
  roots.push(root);
  return root;
}

async function waitForTerminal(manager, operationId) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const state = await manager.status(operationId);
    if (["completed", "failed", "cancelled", "timed_out"].includes(state.status)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`operation did not finish: ${operationId}`);
}
