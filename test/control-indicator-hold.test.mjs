import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";
import { createGatewayOverlaySessionHost } from "../src/gateway-overlay-session.mjs";

/**
 * A multi-step task releases control between steps on purpose. Without a hold
 * the on-screen indicator is torn down and rebuilt once per step, so the person
 * whose desktop is being driven watches it flash and reasonably reads that as
 * the Host losing its grip.
 */
function labRouter() {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async startCursor() {
        calls.push("cursor.start");
      },
      async stopCursor() {
        calls.push("cursor.stop");
      },
    },
    overlayRuntime: {
      async start({ targetRect }) {
        calls.push(`overlay.start:${targetRect?.title ?? "none"}`);
        return {
          visible: true,
          processId: 42,
          retarget(rect) {
            calls.push(`overlay.retarget:${rect?.title ?? "none"}`);
          },
        };
      },
      async stop() {
        calls.push("overlay.stop");
      },
    },
  });
  return { router, calls };
}

function labTicket(router) {
  return { generation: router.lifecycleGeneration, signal: new AbortController().signal };
}

function labWindow(title) {
  return { windowId: title, title, bounds: { x: 10, y: 20, width: 300, height: 180 } };
}

async function showIndicator(router, title) {
  await router.startControlVisuals({
    grant: router.beginControlGrant(),
    tier: "full",
    window: labWindow(title),
    ticket: labTicket(router),
  });
}

test("a held indicator survives the release between task steps", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "task", expiresAt: Date.now() + 60_000 });

  await router.stopControlVisuals();

  assert.ok(router.overlayHandle, "the indicator must outlive a release taken mid-task");
  assert.deepEqual(calls, [
    "cursor.start",
    "overlay.start:Step One",
    // Aimed at nothing, because at this instant no window is being acted on and
    // a frame around one would be a claim the Host cannot back.
    "overlay.retarget:none",
  ]);
});

test("the next step re-aims the held indicator instead of restarting it", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "task", expiresAt: Date.now() + 60_000 });
  await router.stopControlVisuals();
  calls.length = 0;

  await showIndicator(router, "Step Two");

  assert.deepEqual(calls, ["overlay.retarget:Step Two"]);
});

test("an expired hold cannot strand the indicator on someone's desktop", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "task", expiresAt: Date.now() - 1 });

  await router.stopControlVisuals();

  assert.equal(router.overlayHandle, null);
  assert.ok(calls.includes("overlay.stop"), "an expired hold must not keep the indicator alive");
  assert.equal(router.controlIndicatorHold, null, "the expired hold must be forgotten, not re-checked forever");
});

test("releasing the hold takes the indicator down with it", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "task", expiresAt: Date.now() + 60_000 });
  await router.stopControlVisuals();
  calls.length = 0;

  await router.releaseControlIndicator();

  assert.equal(router.controlIndicatorHold, null);
  assert.equal(router.overlayHandle, null);
  assert.deepEqual(calls, ["overlay.stop", "cursor.stop"]);
});

test("releasing the hold leaves a live controller's own indicator alone", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.activeController = { controllerId: "live" };
  calls.length = 0;

  await router.releaseControlIndicator();

  assert.ok(router.overlayHandle, "an indicator belonging to a live grant is not ours to take down");
  assert.deepEqual(calls, []);
});

test("a hold without a deadline is refused rather than held forever", async () => {
  const { router } = labRouter();
  router.setControlIndicatorHold({ id: "task" });
  assert.equal(router.controlIndicatorHold, null);
  assert.equal(router.hasLiveControlIndicatorHold(), false);
});

test("a shorter hold never cuts a longer one short", async () => {
  const { router } = labRouter();
  const far = Date.now() + 120_000;
  router.setControlIndicatorHold({ id: "task", expiresAt: far });
  router.setControlIndicatorHold({ id: "health-check", expiresAt: Date.now() + 1_000 });
  assert.equal(router.controlIndicatorHold.expiresAt, far, "a quick call must not shorten the task behind it");
});

test("the indicator takes itself down when nothing calls again", async () => {
  const { router, calls } = labRouter();
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "session", expiresAt: Date.now() + 40 });
  calls.length = 0;

  // No further tool call arrives: nothing but the deadline can end this.
  await new Promise((resolve) => setTimeout(resolve, 160));

  assert.equal(router.overlayHandle, null, "an abandoned session must hand the desktop back on its own");
  assert.deepEqual(calls, ["overlay.stop", "cursor.stop"]);
});

test("the operator's stop aborts the work, drops the task, and clears the desktop", async () => {
  const { router, calls } = labRouter();
  const dropped = [];
  router.onOperatorStop = (reason) => {
    dropped.push(reason);
  };
  await showIndicator(router, "Step One");
  router.setControlIndicatorHold({ id: "task", expiresAt: Date.now() + 60_000 });
  const inFlight = { desktopMutation: true, signal: { aborted: false }, controller: { abort(reason) { this.aborted = reason; } } };
  router.operationTickets.add(inFlight);
  calls.length = 0;

  await router.requestOperatorStop();

  assert.equal(inFlight.controller.aborted, "The operator stopped the desktop task.");
  assert.deepEqual(dropped, ["The operator stopped the desktop task."]);
  assert.equal(router.controlIndicatorHold, null, "a stop is not a pause: the hold must not survive it");
  assert.equal(router.overlayHandle, null);
  assert.deepEqual(calls, ["overlay.stop", "cursor.stop"]);
});

test("the operator's stop leaves Computer Use usable rather than closing the provider", async () => {
  const { router } = labRouter();
  await showIndicator(router, "Step One");

  await router.requestOperatorStop();

  assert.equal(router.lifecycleState, "open", "Escape ends the task, not the Host");
});

test("starting the indicator subscribes to the operator's stop", async () => {
  const { router } = labRouter();
  let subscribed;
  router.overlayRuntime.start = async () => ({
    visible: true,
    retarget() {},
    onStopRequested(callback) {
      subscribed = callback;
    },
  });
  const stops = [];
  router.onOperatorStop = (reason) => {
    stops.push(reason);
  };

  await showIndicator(router, "Step One");
  assert.equal(typeof subscribed, "function", "an indicator that promises Escape must be listening for it");

  subscribed();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stops, ["The operator stopped the desktop task."]);
});

/** A fake overlay process: never spawned, never killed, but shaped like one. */
function fakeOverlayProcess() {
  return {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    killed: false,
    stderr: { on() {}, off() {} },
    on() {},
    off() {},
    once() {},
    kill() {
      this.killed = true;
    },
  };
}

test("the overlay's stop request reaches the Host", async () => {
  let stopRequested = false;
  const host = createGatewayOverlaySessionHost({
    ensureExecutable: async () => {},
    createRuntimeDirectory: () => mkdtempSync(join(tmpdir(), "indicator-stop-")),
    removeRuntimeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
    spawnOverlay: fakeOverlayProcess,
    markerExists: (path) => (path.endsWith("stop-request") ? stopRequested : true),
    stopRequestPollIntervalMs: 5,
  });

  const handle = await host.start({ environment: {}, targetRect: undefined });
  const seen = await new Promise((resolve) => {
    handle.onStopRequested(() => resolve("stop"));
    stopRequested = true;
  });

  assert.equal(seen, "stop");
  handle.stop();
});

test("the stop channel stops polling once the indicator is gone", async () => {
  const host = createGatewayOverlaySessionHost({
    ensureExecutable: async () => {},
    createRuntimeDirectory: () => mkdtempSync(join(tmpdir(), "indicator-stop-")),
    removeRuntimeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
    spawnOverlay: fakeOverlayProcess,
    markerExists: (path) => !path.endsWith("stop-request"),
    stopRequestPollIntervalMs: 5,
  });

  const handle = await host.start({ environment: {}, targetRect: undefined });
  let fired = false;
  handle.onStopRequested(() => {
    fired = true;
  });
  handle.stop();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(fired, false, "a torn-down indicator must not keep watching the desktop");
});
