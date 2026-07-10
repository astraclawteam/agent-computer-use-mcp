import assert from "node:assert/strict";
import { test } from "node:test";

import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";

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
        disconnect: "controller.closed",
      }[terminal];
      await assert.rejects(access, { code: expectedCode });
      await terminalPromise;

      const state = await router.listState();
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
  await router.close({ reason: "retry-close" });

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
