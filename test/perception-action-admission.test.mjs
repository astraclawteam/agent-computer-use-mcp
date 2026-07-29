import assert from "node:assert/strict";
import { test } from "node:test";

import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";
import { admitPerceptionAction } from "../src/perception-action-admission.mjs";

test("semantic UIA elements are admitted only for the active window lease", () => {
  const decision = admitPerceptionAction({
    observation: observation({ source: "uia-som", elements: [] }),
    element: { source: "uia-som", elementToken: "uia-1", actions: ["click"], pixelLimitedAction: false },
    action: action(),
    now: 100,
  });
  assert.deepEqual(decision, { allowed: true, code: "action.allowed", pixelLimitedAction: false });

  assert.equal(admitPerceptionAction({
    observation: observation({ window: { id: "other-window" } }),
    element: fusedElement(),
    action: action(),
    now: 100,
  }).code, "observation.window_mismatch");
});

test("pixel actions reject missing provenance expiry low confidence and guessed coordinates", () => {
  const cases = [
    [fusedElement({ sourceRegion: undefined }), observation(), "observation.insufficient"],
    [fusedElement({ modelIdentity: undefined }), observation(), "observation.insufficient"],
    [fusedElement({ proposalId: undefined }), observation(), "observation.insufficient"],
    [fusedElement({ confidence: 0.979 }), observation(), "observation.insufficient"],
    [fusedElement({ guessedAction: true }), observation(), "observation.insufficient"],
    [fusedElement(), observation({ expiresAt: 100 }), "observation.expired"],
    [fusedElement(), observation({ includeUserOverlay: true }), "observation.overlay_contaminated"],
  ];
  for (const [element, value, code] of cases) {
    assert.equal(admitPerceptionAction({ observation: value, element, action: action(), now: 100 }).code, code);
  }
});

test("exact high-confidence OCR clicks are admitted while weak OCR and single-source SOM fail closed", () => {
  assert.deepEqual(
    admitPerceptionAction({
      observation: observation({ source: "ocr" }),
      element: ocrElement(),
      action: action(),
      now: 100,
    }),
    { allowed: true, code: "action.allowed", pixelLimitedAction: true },
  );
  assert.equal(
    admitPerceptionAction({
      observation: observation({ source: "ocr" }),
      element: ocrElement({ confidence: 0.97 }),
      action: action(),
      now: 100,
    }).code,
    "observation.insufficient",
  );
  const som = fusedElement({ source: "som-proposal", support: [{ provider: "som-proposal", confidence: 0.999 }] });
  assert.equal(admitPerceptionAction({ observation: observation(), element: som, action: action(), now: 100 }).code, "observation.insufficient");

  for (const flag of ["passwordRegion", "paymentRegion", "privateRegion"]) {
    const element = ocrElement({ [flag]: true });
    assert.equal(admitPerceptionAction({ observation: observation(), element, action: action(), now: 100 }).code, "policy.sensitive_region");
  }
});

test("window-local coordinates require the exact fresh observation and stay inside its capture", () => {
  const value = observation({
    observationId: "capture-1",
    source: "window-capture",
    capture: { width: 960, height: 720 },
  });
  const admitted = admitPerceptionAction({
    observation: value,
    element: null,
    action: action({ kind: "type_text", observationId: "capture-1", x: 500, y: 650 }),
    now: 100,
  });
  assert.deepEqual(admitted, { allowed: true, code: "action.allowed", pixelLimitedAction: true });
  assert.equal(admitPerceptionAction({
    observation: value,
    element: null,
    action: action({ observationId: "other", x: 500, y: 650 }),
    now: 100,
  }).code, "observation.identity_mismatch");
  assert.equal(admitPerceptionAction({
    observation: value,
    element: null,
    action: action({ observationId: "capture-1", x: 1200, y: 650 }),
    now: 100,
  }).code, "observation.insufficient");
});

test("eligible fused and exact approved template proposals are admitted", () => {
  const fused = admitPerceptionAction({ observation: observation(), element: fusedElement(), action: action(), now: 100 });
  assert.deepEqual(fused, { allowed: true, code: "action.allowed", pixelLimitedAction: true });

  const template = admitPerceptionAction({
    observation: observation(),
    element: fusedElement({
      source: "template",
      exact: true,
      approvedActionLabel: true,
      support: [{ provider: "template", confidence: 0.999 }],
    }),
    action: action(),
    now: 100,
  });
  assert.equal(template.allowed, true);
});

test("lease identity and action kind must match the observation and element", () => {
  assert.equal(admitPerceptionAction({
    observation: observation({ controllerId: "controller-2" }),
    element: fusedElement(),
    action: action(),
    now: 100,
  }).code, "observation.lease_mismatch");
  assert.equal(admitPerceptionAction({
    observation: observation(),
    element: fusedElement({ actions: ["click"] }),
    action: action({ kind: "set_value" }),
    now: 100,
  }).code, "observation.insufficient");
});

test("provider router maps an admitted OCR token to a bounded driver pixel click", async (t) => {
  const clicks = [];
  const router = new ComputerUseProviderRouter({
    driver: { async click(args) { clicks.push(args); return { status: "ok" }; } },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", pid: 100, bounds: { width: 960, height: 720 } },
    expiresAt: Date.now() + 10_000,
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...observation({ source: "ocr", expiresAt: Date.now() + 5_000 }),
    elements: [ocrElement()],
  };

  const result = await router.act({ action: { kind: "click", elementToken: "ocr-1" } });
  assert.equal(result.pixelLimitedAction, true);
  assert.deepEqual(clicks, [{
    window: router.activeController.window,
    x: 110,
    y: 60,
    deliveryMode: "background",
  }]);
});

test("provider router keeps action observations fresh for one real Agent reasoning turn", async (t) => {
  const now = 10_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    window: { id: "window-1", title: "Fixture", bounds: { width: 960, height: 720 } },
    expiresAtMs: now + 60_000,
  };

  const observation = router.createActionObservation({ source: "ocr", elements: [] });
  assert.equal(observation.expiresAt, now + 30_000);

  router.activeController.expiresAtMs = now + 12_000;
  const leaseBound = router.createActionObservation({ source: "ocr", elements: [] });
  assert.equal(leaseBound.expiresAt, now + 12_000);
});

test("provider router dispatches screenshot-grounded text and key actions without semantic elements", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(args) { calls.push({ method: "typeText", args }); return { status: "ok" }; },
      async pressKey(args) { calls.push({ method: "pressKey", args }); return { status: "ok" }; },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", pid: 100, bounds: { width: 960, height: 720 } },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...observation({
      observationId: "capture-1",
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  };

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: "capture-1",
      x: 500,
      y: 650,
      value: "hello",
      deliveryMode: "foreground",
    },
  });
  const pressed = await router.act({
    action: {
      kind: "press_key",
      observationId: "capture-1",
      x: 500,
      y: 650,
      key: "return",
      deliveryMode: "foreground",
    },
  });

  assert.equal(typed.pixelLimitedAction, true);
  assert.equal(pressed.pixelLimitedAction, true);
  assert.deepEqual(calls, [
    {
      method: "typeText",
      args: {
        window: router.activeController.window,
        x: 500,
        y: 650,
        value: "hello",
        deliveryMode: "foreground",
      },
    },
    {
      method: "pressKey",
      args: {
        window: router.activeController.window,
        x: 500,
        y: 650,
        key: "return",
        modifiers: undefined,
        deliveryMode: "foreground",
      },
    },
  ]);
});

function observation(overrides = {}) {
  return {
    observationId: "obs-1",
    source: "local-proposal-fusion",
    window: { id: "window-1" },
    controllerId: "controller-1",
    expiresAt: 1000,
    includeUserOverlay: false,
    ...overrides,
  };
}

function fusedElement(overrides = {}) {
  return {
    elementToken: "fused-1",
    source: "local-proposal-fusion",
    sourceRegion: { x: 1, y: 2, width: 80, height: 30 },
    modelIdentity: { provider: "local-proposal-fusion", model: "som-ocr-v1" },
    proposalId: "proposal-1",
    confidence: 0.999,
    support: [{ provider: "ocr", confidence: 0.99 }, { provider: "som-proposal", confidence: 0.94 }],
    guessedAction: false,
    pixelLimitedAction: true,
    actions: ["click"],
    ...overrides,
  };
}

function ocrElement(overrides = {}) {
  return {
    elementToken: "ocr-1",
    elementIndex: 0,
    role: "text",
    name: "Send",
    value: "Send",
    rawTextSha256: "a".repeat(64),
    actions: ["click"],
    bounds: { x: 80, y: 40, width: 60, height: 40 },
    sourceRegion: { x: 80, y: 40, width: 60, height: 40 },
    source: "ocr",
    modelIdentity: { provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small" },
    proposalId: "ocr-proposal-1",
    confidence: 0.999,
    support: [{ provider: "ocr", confidence: 0.999, proposalId: "ocr-proposal-1" }],
    guessedAction: false,
    pixelLimitedAction: true,
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    kind: "click",
    windowId: "window-1",
    controllerId: "controller-1",
    ...overrides,
  };
}
