import assert from "node:assert/strict";
import { test } from "node:test";

import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";
import { CuaDriverMcpClient, CuaDriverMcpDriver } from "../src/cua-driver-mcp-driver.mjs";

test("router close wins before requestAccess registers its control grant", async () => {
  const calls = [];
  const router = createReadyRouter({ calls });

  const access = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  const close = router.close({ reason: "pre-grant-close" });

  await assert.rejects(access, isLifecycleClosed);
  await close;

  assert.equal(router.activeController, null);
  assert.deepEqual(calls, ["driver.close"]);
  await assert.rejects(
    () => router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" }),
    isLifecycleClosed,
  );
});

test("router close during findWindow prevents later controller and visual publication", async () => {
  const calls = [];
  const findEntered = deferred();
  const findGate = deferred();
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        calls.push("window.find");
        findEntered.resolve();
        await findGate.promise;
        return {
          windowId: "lab",
          title: "Computer Use Lab",
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
      },
      async close() {
        calls.push("driver.close");
      },
    },
    overlayRuntime: {
      async start() {
        calls.push("overlay.start");
        return { visible: true, processId: 42 };
      },
      async stop() {
        calls.push("overlay.stop");
      },
    },
  });

  const access = router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await findEntered.promise;
  const close = router.close({ reason: "find-window-close" });
  findGate.resolve();

  await assert.rejects(access, isLifecycleClosed);
  await close;

  assert.equal(router.activeController, null);
  assert.deepEqual(calls, ["window.find", "driver.close"]);
});

test("router shares OCR startup and close waits to close a late-started sidecar", async () => {
  const calls = [];
  const startEntered = deferred();
  const startGate = deferred();
  const router = createReadyRouter({
    calls,
    ocrSession: {
      async start() {
        calls.push("ocr.start");
        startEntered.resolve();
        await startGate.promise;
      },
      async close() {
        calls.push("ocr.close");
      },
    },
  });

  const firstStart = router.ensureOcr();
  const secondStart = router.ensureOcr();
  await startEntered.promise;
  const close = router.close({ reason: "ocr-start-close" });
  startGate.resolve();

  await assert.rejects(firstStart, isLifecycleClosed);
  await assert.rejects(secondStart, isLifecycleClosed);
  await close;

  assert.deepEqual(calls, ["ocr.start", "driver.close", "ocr.close"]);
  await assert.rejects(() => router.ensureOcr(), isLifecycleClosed);
});

test("driver close waits for findWindow and action work and never reconnects", async () => {
  const calls = [];
  const listEntered = deferred();
  const listGate = deferred();
  const clickEntered = deferred();
  const clickGate = deferred();
  const driver = new CuaDriverMcpDriver({
    session: "terminal-driver",
    client: {
      async start() {
        calls.push("client.start");
      },
      async callTool(name) {
        calls.push(name);
        if (name === "list_windows") {
          listEntered.resolve();
          await listGate.promise;
          return { windows: [{ window_id: 7, title: "Computer Use Lab", pid: 77 }] };
        }
        if (name === "click") {
          clickEntered.resolve();
          await clickGate.promise;
        }
        return { status: "ok" };
      },
      async close() {
        calls.push("client.close");
      },
    },
  });

  const find = driver.findWindow({ titlePart: "Computer Use Lab" });
  await listEntered.promise;
  const closeDuringFind = driver.close();
  listGate.resolve();

  await assert.rejects(find, isLifecycleClosed);
  await closeDuringFind;
  assert.deepEqual(calls, ["client.start", "start_session", "list_windows", "end_session", "client.close"]);
  await assert.rejects(() => driver.ensureStarted(), isLifecycleClosed);
  await assert.rejects(() => driver.findWindow({ titlePart: "Computer Use Lab" }), isLifecycleClosed);

  const actionDriver = new CuaDriverMcpDriver({
    session: "terminal-action-driver",
    client: {
      async start() {
        calls.push("action-client.start");
      },
      async callTool(name) {
        calls.push(`action:${name}`);
        if (name === "click") {
          clickEntered.resolve();
          await clickGate.promise;
        }
        return { status: "ok" };
      },
      async close() {
        calls.push("action-client.close");
      },
    },
  });
  const action = actionDriver.click({
    window: { windowId: 8, pid: 88 },
    elementIndex: 1,
    elementToken: "save",
  });
  await clickEntered.promise;
  const closeDuringAction = actionDriver.close();
  clickGate.resolve();

  await assert.rejects(action, isLifecycleClosed);
  await closeDuringAction;
  assert.deepEqual(calls.slice(-5), [
    "action-client.start",
    "action:start_session",
    "action:click",
    "action:end_session",
    "action-client.close",
  ]);
});

test("MCP client close invalidates in-flight start and closed remains terminal", async () => {
  const calls = [];
  const connectEntered = deferred();
  const connectGate = deferred();
  const client = new CuaDriverMcpClient({
    driverPath: "cua-driver",
    client: {
      async connect() {
        calls.push("client.connect");
        connectEntered.resolve();
        await connectGate.promise;
      },
      async close() {
        calls.push("client.close");
      },
    },
    transportFactory: () => {
      calls.push("transport.create");
      return { async close() { calls.push("transport.close"); } };
    },
  });

  const start = client.start();
  await connectEntered.promise;
  const firstClose = client.close();
  const secondClose = client.close();
  connectGate.resolve();

  await assert.rejects(start, isLifecycleClosed);
  await Promise.all([firstClose, secondClose]);
  assert.deepEqual(calls, ["transport.create", "client.connect", "client.close"]);
  await assert.rejects(() => client.start(), isLifecycleClosed);
  assert.deepEqual(calls, ["transport.create", "client.connect", "client.close"]);
});

test("MCP client start during a retryable close waits and then rejects terminally", async () => {
  const calls = [];
  const closeEntered = deferred();
  const closeGate = deferred();
  let closeAttempts = 0;
  const transport = { async close() { calls.push("transport.close"); } };
  const client = new CuaDriverMcpClient({
    driverPath: "cua-driver",
    client: {
      async connect() {
        calls.push("client.connect");
      },
      async close() {
        closeAttempts += 1;
        calls.push(`client.close:${closeAttempts}`);
        closeEntered.resolve();
        await closeGate.promise;
        if (closeAttempts === 1) throw new Error("transient close failure");
      },
    },
    transportFactory: () => transport,
  });
  client.transport = transport;
  client.started = true;

  const firstClose = client.close();
  const concurrentClose = client.close();
  await closeEntered.promise;
  const startDuringClose = client.start();
  closeGate.resolve();

  await assert.rejects(firstClose, /transient close failure/);
  await assert.rejects(concurrentClose, /transient close failure/);
  await assert.rejects(startDuringClose, isLifecycleClosed);
  await assert.rejects(() => client.start(), isLifecycleClosed);
  await client.close();

  assert.equal(closeAttempts, 2);
  assert.equal(client.transport, null);
  assert.deepEqual(calls, ["client.close:1", "client.close:2"]);
});

for (const stage of ["cursor", "overlay"]) {
  for (const terminal of ["cancel", "revoke", "timeout", "disconnect"]) {
    test(`${terminal} during ${stage} startup cannot leave control visuals without a lease`, async () => {
      let now = 1_000;
      const gate = deferred();
      const entered = deferred();
      const calls = [];
      const router = new ComputerUseProviderRouter({
        clock: {
          now: () => now,
          iso: (timeMs = now) => new Date(timeMs).toISOString(),
        },
        driver: {
          async findWindow() {
            return {
              windowId: "lab",
              title: "Computer Use Lab",
              bounds: { x: 10, y: 20, width: 300, height: 180 },
            };
          },
          async startCursor() {
            calls.push("cursor.start");
            if (stage === "cursor") {
              entered.resolve();
              await gate.promise;
            }
          },
          async stopCursor() {
            calls.push("cursor.stop");
          },
          async close() {
            calls.push("driver.close");
          },
        },
        overlayRuntime: {
          async start() {
            calls.push("overlay.start");
            if (stage === "overlay") {
              entered.resolve();
              await gate.promise;
            }
            return { visible: true, processId: 42 };
          },
          async stop() {
            calls.push("overlay.stop");
          },
        },
      });

      const access = router.requestAccess({
        titlePart: "Computer Use Lab",
        tier: "full",
        leaseTtlMs: 50,
      });
      await entered.promise;

      let terminalPromise;
      if (terminal === "cancel") {
        terminalPromise = router.cancel({ reason: "startup-cancel" });
      } else if (terminal === "revoke") {
        terminalPromise = router.revoke({ reason: "startup-revoke" });
      } else if (terminal === "timeout") {
        now = 1_051;
        terminalPromise = router.listState();
      } else {
        terminalPromise = router.close({ reason: "client-disconnect" });
      }

      await Promise.resolve();
      gate.resolve();

      const expectedCode = {
        cancel: "controller.cancelled",
        revoke: "controller.revoked",
        timeout: "controller.expired",
        disconnect: "lifecycle.closed",
      }[terminal];
      await assert.rejects(access, { code: expectedCode });
      await terminalPromise;

      const state = terminal === "disconnect"
        ? { activeController: router.activeController }
        : await router.listState();
      assert.equal(state.activeController, null);
      assert.equal(calls.filter((call) => call === "cursor.start").length, 1);
      assert.equal(calls.filter((call) => call === "cursor.stop").length, 1);
      assert.equal(calls.filter((call) => call === "overlay.start").length, stage === "overlay" ? 1 : 0);
      assert.equal(calls.filter((call) => call === "overlay.stop").length, stage === "overlay" ? 1 : 0);
      assert.equal(calls.filter((call) => call === "driver.close").length, terminal === "disconnect" ? 1 : 0);
    });
  }
}

test("observe access keeps the user overlay but never starts the control cursor", async () => {
  const calls = [];
  const router = createReadyRouter({ calls });

  const access = await router.requestAccess({ titlePart: "Computer Use Lab", tier: "observe" });
  assert.equal(access.status, "granted");
  assert.equal(access.overlay.visible, true);
  await router.cancel({ reason: "observe-complete" });

  assert.deepEqual(calls, ["overlay.start", "overlay.stop"]);
});

test("router close coalesces concurrent calls and repeated success does not duplicate resource cleanup", async () => {
  const calls = [];
  const assetGate = deferred();
  const assetEntered = deferred();
  const router = createReadyRouter({
    calls,
    assetOperationManager: {
      async close() {
        calls.push("assets.close");
        assetEntered.resolve();
        await assetGate.promise;
      },
    },
    ocrSession: {
      async start() {
        calls.push("ocr.start");
      },
      async close() {
        calls.push("ocr.close");
      },
    },
  });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await router.ensureOcr();
  const first = router.close({ reason: "first-close" });
  const concurrent = router.close({ reason: "concurrent-close" });
  await assetEntered.promise;
  assetGate.resolve();
  await Promise.all([first, concurrent]);
  await router.close({ reason: "repeated-close" });

  assert.deepEqual(calls, [
    "cursor.start",
    "overlay.start",
    "ocr.start",
    "assets.close",
    "overlay.stop",
    "cursor.stop",
    "driver.close",
    "ocr.close",
  ]);
});

test("router close retains failed overlay and OCR cleanup state for retry while preserving the first error", async () => {
  const calls = [];
  const overlayError = new Error("overlay close failed");
  const ocrError = new Error("ocr close failed");
  let overlayAttempts = 0;
  let ocrAttempts = 0;
  const router = createReadyRouter({
    calls,
    overlayStop: async () => {
      calls.push("overlay.stop");
      overlayAttempts += 1;
      if (overlayAttempts === 1) throw overlayError;
    },
    assetOperationManager: {
      async close() {
        calls.push("assets.close");
      },
    },
    ocrSession: {
      async start() {
        calls.push("ocr.start");
      },
      async close() {
        calls.push("ocr.close");
        ocrAttempts += 1;
        if (ocrAttempts === 1) throw ocrError;
      },
    },
  });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await router.ensureOcr();
  await assert.rejects(
    () => router.close({ reason: "failing-close" }),
    (error) => error === overlayError,
  );
  await assert.rejects(
    () => router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" }),
    isLifecycleClosed,
  );
  await router.close({ reason: "retry-close" });
  await assert.rejects(
    () => router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" }),
    isLifecycleClosed,
  );

  assert.equal(overlayAttempts, 2);
  assert.equal(ocrAttempts, 2);
  assert.equal(calls.filter((call) => call === "assets.close").length, 1);
  assert.equal(calls.filter((call) => call === "cursor.stop").length, 1);
  assert.equal(calls.filter((call) => call === "driver.close").length, 1);
});

function createReadyRouter({
  calls,
  overlayStop = async () => {
    calls.push("overlay.stop");
  },
  assetOperationManager,
  ocrSession,
} = {}) {
  return new ComputerUseProviderRouter({
    assetOperationManager,
    ocrSession,
    driver: {
      async findWindow() {
        return {
          windowId: "lab",
          title: "Computer Use Lab",
          bounds: { x: 10, y: 20, width: 300, height: 180 },
        };
      },
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
      },
      async close() {
        calls.push("driver.close");
      },
    },
    overlayRuntime: {
      async start() {
        calls.push("overlay.start");
        return { visible: true, processId: 42 };
      },
      stop: overlayStop,
    },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function isLifecycleClosed(error) {
  assert.equal(error?.code, "lifecycle.closed");
  return true;
}
