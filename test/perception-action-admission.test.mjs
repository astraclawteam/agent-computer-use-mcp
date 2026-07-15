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

test("single-source OCR or SOM and sensitive regions fail closed", () => {
  for (const source of ["ocr", "som-proposal"]) {
    const element = fusedElement({ support: [{ provider: source, confidence: 0.999 }] });
    assert.equal(admitPerceptionAction({ observation: observation(), element, action: action(), now: 100 }).code, "observation.insufficient");
  }
  for (const flag of ["passwordRegion", "paymentRegion", "privateRegion"]) {
    const element = fusedElement({ [flag]: true });
    assert.equal(admitPerceptionAction({ observation: observation(), element, action: action(), now: 100 }).code, "policy.sensitive_region");
  }
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

test("provider router centrally rejects a single-source OCR click before driver dispatch", async (t) => {
  let clicked = false;
  const router = new ComputerUseProviderRouter({
    driver: { async click() { clicked = true; return { status: "ok" }; } },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", title: "Fixture" },
    expiresAt: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...observation({ expiresAt: Date.now() + 5_000 }),
    elements: [fusedElement({
      elementToken: "ocr-1",
      source: "ocr",
      modelIdentity: { provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small" },
      support: [{ provider: "ocr", confidence: 0.999 }],
    })],
  };

  await assert.rejects(
    router.act({ action: { kind: "click", elementToken: "ocr-1" } }),
    /observation\.insufficient/u,
  );
  assert.equal(clicked, false);
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

function action(overrides = {}) {
  return {
    kind: "click",
    windowId: "window-1",
    controllerId: "controller-1",
    ...overrides,
  };
}
