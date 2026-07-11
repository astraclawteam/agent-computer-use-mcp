import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { createGatewayOverlaySessionHost } from "../src/gateway-overlay-session.mjs";

test("overlay host reports visible only after the native readiness marker exists", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "overlay-host-ready-"));
  const child = new FakeChild();
  let spawnEnvironment;
  const host = createHost(runtimeDir, child, ({ env }) => {
    spawnEnvironment = env;
    queueMicrotask(() => writeFileSync(env.AGENT_COMPUTER_USE_OVERLAY_READY_FILE, "ready", "utf8"));
  });

  const overlay = await host.start({ startupTimeoutMs: 100, readinessPollIntervalMs: 2 });

  assert.equal(overlay.visible, true);
  assert.equal(spawnEnvironment.AGENT_COMPUTER_USE_OVERLAY_READY_FILE, spawnEnvironment.XIAOZHICLAW_CUA_OVERLAY_READY_FILE);
  assert.equal(existsSync(spawnEnvironment.AGENT_COMPUTER_USE_OVERLAY_READY_FILE), true);
  overlay.stop();
  assert.equal(child.killed, true);
  assert.equal(existsSync(runtimeDir), false);
});

test("overlay host rejects early child exit with stderr and removes temp state", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "overlay-host-exit-"));
  const child = new FakeChild();
  const host = createHost(runtimeDir, child, () => {
    queueMicrotask(() => child.exit(3, "no eligible physical display"));
  });

  await assert.rejects(
    host.start({ startupTimeoutMs: 100, readinessPollIntervalMs: 2 }),
    /exited before readiness with code 3: no eligible physical display/,
  );

  assert.equal(existsSync(runtimeDir), false);
});

test("overlay host kills a child that times out before readiness and removes temp state", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "overlay-host-timeout-"));
  const child = new FakeChild();
  child.exitAfterKillMs = 5;
  const host = createHost(runtimeDir, child);

  await assert.rejects(
    host.start({ startupTimeoutMs: 20, readinessPollIntervalMs: 2 }),
    /did not become ready within 20ms/,
  );

  assert.equal(child.killed, true);
  assert.equal(child.exitCode, 143);
  assert.equal(existsSync(runtimeDir), false);
});

function createHost(runtimeDir, child, afterSpawn = () => {}) {
  return createGatewayOverlaySessionHost({
    ensureExecutable: async () => {},
    createRuntimeDirectory: () => runtimeDir,
    spawnOverlay(options) {
      afterSpawn(options);
      return child;
    },
    removeRuntimeDirectory(path) {
      rmSync(path, { recursive: true, force: true });
    },
  });
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4321;
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.exitAfterKillMs = null;
  }

  kill() {
    this.killed = true;
    this.signalCode = "SIGTERM";
    if (this.exitAfterKillMs !== null) {
      setTimeout(() => this.exit(143), this.exitAfterKillMs);
    }
    return true;
  }

  exit(code, stderr = "") {
    if (stderr) this.stderr.write(stderr);
    this.exitCode = code;
    this.emit("exit", code, null);
  }
}
