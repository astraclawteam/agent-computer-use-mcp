import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComputerUseProviderRouter,
  planPostActionEffectRegion,
  planPostActionObservationCrop,
} from "../src/computer-use-provider-router.mjs";
import { admitPerceptionAction } from "../src/perception-action-admission.mjs";

test("window activation is admitted from the active controller without perception geometry", () => {
  assert.deepEqual(
    admitPerceptionAction({ action: { kind: "activate_window" } }),
    { allowed: true, code: "action.allowed", pixelLimitedAction: false },
  );
});

test("post-action verification stays around the action target instead of unrelated dynamic regions", () => {
  const observation = {
    coordinateBounds: { x: 0, y: 0, width: 952, height: 722 },
  };

  assert.deepEqual(
    planPostActionObservationCrop({
      kind: "click",
      x: 30,
      y: 689,
      targetBounds: { x: 13, y: 676, width: 34, height: 26 },
    }, observation),
    { x: 0, y: 362, width: 384, height: 360 },
  );
  assert.deepEqual(
    planPostActionObservationCrop({
      kind: "click",
      x: 475,
      y: 315,
      targetBounds: { x: 450, y: 300, width: 50, height: 30 },
    }, observation),
    { x: 283, y: 135, width: 384, height: 360 },
  );
});

test("selection verification also observes the largest complementary pane", () => {
  const observation = {
    coordinateBounds: { x: 0, y: 0, width: 952, height: 722 },
  };

  assert.deepEqual(
    planPostActionEffectRegion({
      kind: "click",
      interactionIntent: "select-item",
      targetBounds: { x: 60, y: 346, width: 234, height: 50 },
    }, observation),
    { x: 294, y: 0, width: 658, height: 722 },
  );
  assert.equal(
    planPostActionEffectRegion({
      kind: "click",
      interactionIntent: "activate-control",
      targetBounds: { x: 60, y: 346, width: 234, height: 50 },
    }, observation),
    null,
  );
});

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
      action: action({ interactionIntent: "activate-recognized-text" }),
      now: 100,
    }),
    { allowed: true, code: "action.allowed", pixelLimitedAction: true },
  );
  assert.equal(
    admitPerceptionAction({
      observation: observation({ source: "ocr" }),
      element: ocrElement({ confidence: 0.97 }),
      action: action({ interactionIntent: "activate-recognized-text" }),
      now: 100,
    }).code,
    "observation.insufficient",
  );
  const som = fusedElement({ source: "som-proposal", support: [{ provider: "som-proposal", confidence: 0.999 }] });
  assert.equal(admitPerceptionAction({ observation: observation(), element: som, action: action(), now: 100 }).code, "observation.insufficient");

  for (const flag of ["passwordRegion", "paymentRegion", "privateRegion"]) {
    const element = ocrElement({ [flag]: true });
    assert.equal(admitPerceptionAction({
      observation: observation(),
      element,
      action: action({ interactionIntent: "activate-recognized-text" }),
      now: 100,
    }).code, "policy.sensitive_region");
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
    action: action({
      kind: "type_text",
      observationId: "capture-1",
      x: 500,
      y: 650,
      targetBounds: { x: 400, y: 600, width: 200, height: 100 },
    }),
    now: 100,
  });
  assert.deepEqual(admitted, { allowed: true, code: "action.allowed", pixelLimitedAction: true });
  assert.equal(admitPerceptionAction({
    observation: value,
    element: null,
    action: action({ kind: "type_text", observationId: "capture-1", x: 500, y: 650 }),
    now: 100,
  }).code, "target.editable_interior_required");
  assert.equal(admitPerceptionAction({
    observation: value,
    element: null,
    action: action({
      kind: "type_text",
      observationId: "capture-1",
      x: 415,
      y: 605,
      targetBounds: { x: 400, y: 600, width: 200, height: 100 },
    }),
    now: 100,
  }).code, "target.editable_interior_required");
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

test("a non-editable click cannot reuse the latest text-entry surface as a result row", () => {
  const value = observation({
    observationId: "screenshot-after-text",
    source: "window-capture",
    expiresAt: 1_000,
    capture: { width: 960, height: 720 },
  });
  const recentEditableTarget = {
    controllerId: "controller-1",
    windowId: "window-1",
    bounds: { x: 75, y: 43, width: 200, height: 26 },
    expiresAtMs: 1_000,
  };
  const rejected = admitPerceptionAction({
    observation: value,
    recentEditableTarget,
    action: action({
      kind: "click",
      observationId: "screenshot-after-text",
      coordinateSpace: "window-local",
      interactionIntent: "select-item",
      targetRole: "list-item",
      targetBounds: { x: 64, y: 38, width: 72, height: 36 },
      x: 100,
      y: 56,
    }),
    now: 100,
  });

  assert.equal(rejected.allowed, false);
  assert.equal(rejected.code, "target.overlaps_recent_editable_surface");
  assert.deepEqual(rejected.rejectedRegion, recentEditableTarget.bounds);

  const admitted = admitPerceptionAction({
    observation: value,
    recentEditableTarget,
    action: action({
      kind: "click",
      observationId: "screenshot-after-text",
      coordinateSpace: "window-local",
      interactionIntent: "select-item",
      targetRole: "list-item",
      targetBounds: { x: 75, y: 100, width: 300, height: 64 },
      x: 225,
      y: 132,
    }),
    now: 100,
  });
  assert.equal(admitted.allowed, true);
});

test("editable pixel clicks require explicit focus intent", () => {
  const decision = admitPerceptionAction({
    observation: observation({
      observationId: "editable-surface-1",
      source: "window-capture",
      capture: { width: 960, height: 720 },
    }),
    action: action({
      kind: "click",
      observationId: "editable-surface-1",
      coordinateSpace: "window-local",
      x: 160,
      y: 50,
      targetBounds: { x: 60, y: 35, width: 200, height: 40 },
      interactionIntent: "activate-control",
      targetRole: "editable",
    }),
    now: 100,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "target.editable_focus_intent_required");
  assert.equal(decision.pixelLimitedAction, false);
  assert.equal(decision.requiredInteractionIntent, "focus-editable");
  assert.match(decision.nextAction, /Prefer one atomic type_text/u);
});

test("screenshot-grounded editable focus click is admitted only with full safe bounds", () => {
  const value = observation({
    observationId: "editable-focus-1",
    source: "window-capture",
    capture: { width: 960, height: 720 },
  });
  const admitted = admitPerceptionAction({
    observation: value,
    action: action({
      kind: "click",
      observationId: "editable-focus-1",
      coordinateSpace: "window-local",
      x: 160,
      y: 55,
      targetBounds: { x: 60, y: 35, width: 200, height: 40 },
      interactionIntent: "focus-editable",
      targetRole: "editable",
    }),
    now: 100,
  });
  assert.deepEqual(admitted, { allowed: true, code: "action.allowed", pixelLimitedAction: true });

  const wrongRole = admitPerceptionAction({
    observation: value,
    action: action({
      kind: "click",
      observationId: "editable-focus-1",
      coordinateSpace: "window-local",
      x: 160,
      y: 55,
      targetBounds: { x: 60, y: 35, width: 200, height: 40 },
      interactionIntent: "focus-editable",
      targetRole: "button",
    }),
    now: 100,
  });
  assert.equal(wrongRole.code, "target.editable_role_required");
});

test("OCR glyph coordinates cannot ground keyboard actions", () => {
  const value = observation({
    observationId: "ocr-1",
    source: "ocr",
    mode: "ocr",
    capture: { width: 960, height: 720 },
  });
  for (const kind of ["type_text", "press_key"]) {
    const decision = admitPerceptionAction({
      observation: value,
      element: null,
      action: action({ kind, observationId: "ocr-1", x: 89, y: 55 }),
      now: 100,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "target.editable_interior_required");
    assert.equal(decision.rejectedGrounding, "ocr-recognized-text");
    assert.equal(decision.requiredObservationMode, "screenshot");
    assert.equal(decision.requiredGrounding, "editable-interior");
  }
});

test("OCR geometry cannot masquerade as an editable-focus click", () => {
  const value = observation({
    observationId: "ocr-1",
    source: "ocr",
    mode: "ocr",
    capture: { width: 960, height: 720 },
  });
  const missingIntent = admitPerceptionAction({
    observation: value,
    element: null,
    action: action({ observationId: "ocr-1", x: 89, y: 55 }),
    now: 100,
  });
  assert.equal(missingIntent.code, "target.interaction_intent_required");

  const focusClick = admitPerceptionAction({
    observation: value,
    element: null,
    action: action({
      observationId: "ocr-1",
      x: 89,
      y: 55,
      targetBounds: { x: 40, y: 35, width: 180, height: 40 },
      interactionIntent: "focus-editable",
      targetRole: "editable",
    }),
    now: 100,
  });
  assert.equal(focusClick.code, "target.visual_grounding_required");
  assert.equal(focusClick.requiredObservationMode, "screenshot");

  assert.deepEqual(
    admitPerceptionAction({
      observation: value,
      element: null,
      action: action({
        observationId: "ocr-1",
        x: 89,
        y: 55,
        interactionIntent: "activate-recognized-text",
      }),
      now: 100,
    }),
    { allowed: true, code: "action.allowed", pixelLimitedAction: true },
  );
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

test("targetless keyboard actions require an explicit focus receipt", () => {
  assert.equal(admitPerceptionAction({
    observation: observation(),
    element: null,
    action: action({ kind: "press_key", key: "escape" }),
    now: 100,
  }).code, "focus.receipt_required");
  assert.equal(admitPerceptionAction({
    observation: observation(),
    element: null,
    action: action({ kind: "type_text", value: "focused input" }),
    now: 100,
  }).code, "focus.receipt_required");
  assert.deepEqual(admitPerceptionAction({
    observation: observation(),
    element: null,
    action: action({ kind: "press_key", key: "escape", focusReceiptId: "focus-1" }),
    now: 100,
  }), {
    allowed: true,
    code: "action.allowed",
    pixelLimitedAction: false,
  });
  assert.deepEqual(admitPerceptionAction({
    observation: observation(),
    element: null,
    action: action({ kind: "type_text", value: "focused input", focusReceiptId: "focus-1" }),
    now: 100,
  }), {
    allowed: true,
    code: "action.allowed",
    pixelLimitedAction: false,
  });
  assert.deepEqual(admitPerceptionAction({
    observation: observation({ expiresAt: 99 }),
    element: null,
    action: action({ kind: "press_key", key: "escape", focusReceiptId: "focus-1" }),
    now: 100,
  }), {
    allowed: true,
    code: "action.allowed",
    pixelLimitedAction: false,
  });
  assert.deepEqual(admitPerceptionAction({
    observation: null,
    element: null,
    action: action({ kind: "type_text", value: "focused input", focusReceiptId: "focus-1" }),
    now: 100,
  }), {
    allowed: true,
    code: "action.allowed",
    pixelLimitedAction: false,
  });
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

  const result = await router.act({
    action: {
      kind: "click",
      elementToken: "ocr-1",
      interactionIntent: "activate-recognized-text",
    },
  });
  assert.equal(result.pixelLimitedAction, true);
  assert.deepEqual(clicks, [{
    window: router.activeController.window,
    x: 110,
    y: 60,
    deliveryMode: "foreground",
  }]);
  assert.equal(result.status, "ok");
  assert.equal(result.focusReceipt, undefined);
});

test("explicitly unverified pixel clicks are indeterminate and require observation", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", effect: "unverifiable", verified: false };
      },
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return { status: "ok", verified: true };
      },
      async capture() {
        calls.push({ method: "capture" });
        return {
          observationId: "capture-after-click",
          source: "window-capture",
          capture: { width: 960, height: 720 },
          elements: [],
        };
      },
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
      observationId: "capture-before-click",
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  };

  const clicked = await router.act({
    action: {
      kind: "click",
      observationId: "capture-before-click",
      coordinateSpace: "window-local",
      x: 100,
      y: 50,
      interactionIntent: "activate-control",
    },
  });
  assert.equal(clicked.status, "indeterminate");
  assert.equal(clicked.outcome, "unverified");
  assert.equal(clicked.effectiveDeliveryMode, "foreground");
  assert.equal(clicked.focusReceipt, undefined);
  assert.deepEqual(clicked.result.recovery, {
    requiresFreshObservation: true,
    sameActionReplayAllowed: false,
    textEntry: {
      when: "The intended interaction is text entry on a custom-drawn surface.",
      useActionKind: "type_text",
        targetRequirement: "Capture a fresh screenshot, visually verify focus, and ground a point strictly inside the editable surface. Use that screenshot observationId and projected x/y in one type_text call. OCR glyph bounds and interactionPoint values cannot ground keyboard actions. Never add window.bounds.x/y to window-local coordinates.",
    },
  });
  await assert.rejects(
    router.act({
      action: {
        kind: "type_text",
        observationId: "capture-before-click",
        coordinateSpace: "window-local",
        x: 100,
        y: 50,
        targetBounds: { x: 50, y: 20, width: 100, height: 60 },
        value: "blocked",
        textMode: "insert",
      },
    }),
    (error) => error.code === "action.observation_required_after_unverified_mutation",
  );

  await router.capture({ mode: "semantic" });
  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: "capture-after-click",
      coordinateSpace: "window-local",
      x: 100,
      y: 50,
      targetBounds: { x: 50, y: 20, width: 100, height: 60 },
      value: "foreground text",
      textMode: "insert",
    },
  });
  assert.equal(typed.status, "ok");
  assert.equal(typed.effectiveDeliveryMode, "foreground");
  assert.deepEqual(calls.map((call) => call.method), ["click", "capture", "typeText"]);
});

test("semantic clicks are verified by a fresh state transition when the driver cannot verify them", async (t) => {
  const calls = [];
  let captureCount = 0;
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", effect: "unverifiable", verified: false };
      },
      async capture() {
        calls.push({ method: "capture" });
        captureCount += 1;
        return {
          observationId: `semantic-after-click-${captureCount}`,
          source: "cua-driver",
          mode: "semantic",
          elements: [
            {
              elementToken: `next-display-${captureCount}`,
              role: "text",
              name: `Display ${captureCount}`,
              actions: [],
              source: "cua-driver",
            },
            {
              elementToken: `next-button-${captureCount}`,
              role: "button",
              name: "One",
              actions: ["click"],
              source: "cua-driver",
            },
          ],
          includeUserOverlay: false,
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Calculator", pid: 100, bounds: { width: 320, height: 540 } },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...observation({
      observationId: "semantic-before-click",
      source: "cua-driver",
      expiresAt: Date.now() + 5_000,
    }),
    elements: [
      {
        elementToken: "button-one",
        role: "button",
        name: "One",
        actions: ["click"],
        source: "cua-driver",
      },
      {
        elementToken: "display",
        role: "text",
        name: "Display 0",
        actions: [],
        source: "cua-driver",
      },
    ],
  };
  router.rememberSemanticElements(router.lastCapture);

  const clicked = await router.act({
    action: {
      kind: "click",
      elementToken: "button-one",
      interactionIntent: "activate-control",
    },
  });

  assert.equal(clicked.status, "ok");
  assert.equal(clicked.outcome, "applied");
  assert.equal(clicked.result.verified, true);
  assert.equal(clicked.result.verification.status, "changed");
  assert.equal(clicked.result.verification.observation.observationId, "semantic-after-click-1");
  assert.equal(router.pendingUnverifiedMutation, null);

  const clickedAgainWithOriginalToken = await router.act({
    action: {
      kind: "click",
      elementToken: "button-one",
      interactionIntent: "activate-control",
    },
  });
  assert.equal(clickedAgainWithOriginalToken.status, "ok");
  assert.equal(clickedAgainWithOriginalToken.outcome, "applied");
  assert.equal(calls.filter((call) => call.method === "click")[1].args.elementToken, "next-button-1");
  assert.deepEqual(calls.map((call) => call.method), ["click", "capture", "click", "capture"]);
});

test("semantic clicks with no immediate state transition are delivered once and defer verification", async (t) => {
  const calls = [];
  const stableElements = [
    {
      elementToken: "plus",
      role: "button",
      name: "Add",
      actions: ["click"],
      source: "cua-driver",
      bounds: { x: 20, y: 20, width: 40, height: 40 },
    },
    {
      elementToken: "display",
      role: "text",
      name: "Display is 321",
      actions: [],
      source: "cua-driver",
      bounds: { x: 10, y: 10, width: 100, height: 20 },
    },
  ];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click() {
        calls.push("click");
        return { status: "ok", effect: "unverifiable", verified: false };
      },
      async capture() {
        calls.push("capture");
        return {
          observationId: "calculator-after",
          source: "cua-driver",
          elements: stableElements.map((element, index) => ({
            ...element,
            elementToken: `s0002:${index}`,
          })),
          includeUserOverlay: false,
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", pid: 100, bounds: { width: 320, height: 540 } },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...router.createActionObservation({
      observationId: "calculator-before",
      source: "cua-driver",
      elements: stableElements,
      includeUserOverlay: false,
    }),
    controllerId: "controller-1",
  };

  const clicked = await router.act({
    action: {
      kind: "click",
      elementToken: "plus",
      interactionIntent: "activate-control",
    },
  });

  assert.equal(clicked.status, "ok");
  assert.equal(clicked.outcome, "delivered");
  assert.equal(clicked.result.effect, "delivered_unobserved");
  assert.equal(clicked.result.delivered, true);
  assert.equal(clicked.result.replaySafe, false);
  assert.equal(clicked.result.completionEligible, false);
  assert.equal(clicked.result.verificationRequired, "later_observable_boundary");
  assert.match(clicked.result.nextAction, /Do not replay/u);
  assert.equal(clicked.result.verification.status, "unchanged");
  assert.deepEqual(calls, ["click", "capture"]);
});

test("parallel Agent actions are serialized across fresh semantic token generations", async (t) => {
  const clickedTokens = [];
  let captureCount = 0;
  const router = new ComputerUseProviderRouter({
    driver: {
      async click({ elementToken }) {
        clickedTokens.push(elementToken);
        return { status: "ok", effect: "unverifiable", verified: false };
      },
      async capture() {
        captureCount += 1;
        return {
          observationId: `parallel-after-${captureCount}`,
          source: "cua-driver",
          elements: [
            {
              elementToken: `next-button-${captureCount}`,
              role: "button",
              name: "One",
              actions: ["click"],
              source: "cua-driver",
            },
            {
              elementToken: `next-display-${captureCount}`,
              role: "text",
              name: `Display ${captureCount}`,
              actions: [],
              source: "cua-driver",
            },
          ],
          includeUserOverlay: false,
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Calculator", pid: 100, bounds: { width: 320, height: 540 } },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = {
    ...observation({
      observationId: "parallel-before",
      source: "cua-driver",
      expiresAt: Date.now() + 5_000,
    }),
    elements: [
      {
        elementToken: "button-one",
        role: "button",
        name: "One",
        actions: ["click"],
        source: "cua-driver",
      },
      {
        elementToken: "display",
        role: "text",
        name: "Display 0",
        actions: [],
        source: "cua-driver",
      },
    ],
  };
  router.rememberSemanticElements(router.lastCapture);

  const results = await Promise.all([
    router.act({ action: { kind: "click", elementToken: "button-one", interactionIntent: "activate-control" } }),
    router.act({ action: { kind: "click", elementToken: "button-one", interactionIntent: "activate-control" } }),
    router.act({ action: { kind: "click", elementToken: "button-one", interactionIntent: "activate-control" } }),
  ]);

  assert.deepEqual(clickedTokens, ["button-one", "next-button-1", "next-button-2"]);
  assert.deepEqual(results.map((result) => result.status), ["ok", "ok", "ok"]);
  assert.deepEqual(results.map((result) => result.outcome), ["applied", "applied", "applied"]);
});

test("verified activation issues a focus receipt that can verify targetless text by state transition", async (t) => {
  let captureCount = 0;
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        return {
          windowId: "calculator-window",
          title: "Calculator",
          pid: 100,
          bounds: { width: 320, height: 540 },
        };
      },
      async activateWindow({ window }) {
        calls.push("activateWindow");
        return {
          status: "ok",
          effect: "applied",
          verified: true,
          foregroundWindow: { ...window, isForeground: true },
        };
      },
      async capture() {
        calls.push("capture");
        captureCount += 1;
        return {
          observationId: `calculator-${captureCount}`,
          source: "cua-driver",
          mode: "semantic",
          elements: [{
            elementToken: `display-${captureCount}`,
            role: "text",
            name: captureCount === 1 ? "Display 0" : "Display 579",
            actions: [],
            source: "cua-driver",
          }],
          includeUserOverlay: false,
        };
      },
      async typeText(args) {
        calls.push("typeText");
        assert.equal(args.value, "123+456=");
        return { status: "ok", effect: "possibly_applied", verified: false };
      },
    },
    overlayRuntime: {
      async start() {
        return { visible: true };
      },
      async stop() {},
    },
  });
  t.after(() => router.close());

  await router.requestAccess({ titlePart: "Calculator", tier: "full", agentId: "agent-1" });
  const activated = await router.act({ action: { kind: "activate_window" } });
  const typed = await router.act({
    action: {
      kind: "type_text",
      value: "123+456=",
      textMode: "insert",
      inputBehavior: "incremental",
      focusReceiptId: activated.focusReceipt.id,
    },
  });

  assert.equal(activated.focusReceipt.status, "verified");
  assert.equal(activated.result.observation.observationId, "calculator-1");
  assert.equal(typed.status, "ok");
  assert.equal(typed.outcome, "applied");
  assert.equal(typed.result.verification.status, "changed");
  assert.deepEqual(calls, ["activateWindow", "capture", "typeText", "capture"]);
});

test("screenshot requests stay on the low-latency semantic path when actionable coverage is sufficient", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async capture() {
        calls.push("capture");
        return {
          observationId: "semantic-short-circuit",
          source: "cua-driver",
          mode: "semantic",
          elements: ["One", "Two", "Three", "Equals"].map((name, index) => ({
            elementToken: `button-${index}`,
            role: "button",
            name,
            actions: ["click"],
            source: "cua-driver",
          })),
          includeUserOverlay: false,
        };
      },
      async captureWindow() {
        calls.push("captureWindow");
        throw new Error("vision path must not run");
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", pid: 100, bounds: { width: 320, height: 540 } },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };

  const captured = await router.capture({ mode: "screenshot" });

  assert.equal(captured.requestedMode, "screenshot");
  assert.equal(captured.perceptionRouting.selectedMode, "semantic");
  assert.equal(captured.perceptionRouting.avoidedVision, true);
  assert.equal(captured.perceptionRouting.actionableElementCount, 4);
  assert.deepEqual(calls, ["capture"]);
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

  router.activeController.expiresAtMs = now + 300_000;
  const screenshot = router.createActionObservation({
    source: "cua-driver-window-state",
    artifact: { mimeType: "image/png" },
    elements: [],
  });
  assert.equal(screenshot.expiresAt, now + 120_000);

  router.activeController.expiresAtMs = now + 12_000;
  const leaseBound = router.createActionObservation({ source: "ocr", elements: [] });
  assert.equal(leaseBound.expiresAt, now + 12_000);
});

test("screenshot geometry outranks stale minimized-window bounds", async (t) => {
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
    window: {
      id: "window-1",
      title: "Fixture",
      bounds: { x: -32_000, y: -32_000, width: 146, height: 21 },
    },
    expiresAtMs: now + 60_000,
  };

  const observation = router.createActionObservation({
    source: "window-capture",
    capture: { x: 100, y: 120, width: 960, height: 720 },
  });

  assert.deepEqual(observation.window.bounds, {
    x: 100,
    y: 120,
    width: 960,
    height: 720,
  });
  assert.equal(observation.coordinateSpace, "window-local");
  assert.deepEqual(observation.coordinateBounds, {
    x: 0,
    y: 0,
    width: 960,
    height: 720,
  });
  assert.equal(observation.coordinateTransform, "identity");
  assert.deepEqual(observation.interactionContract, {
    textEntry: {
      actionKind: "type_text",
      atomicFocus: true,
      separateFocusClick: "screenshot-grounded-focus-receipt-only",
      focusContinuation: "A verified focus-editable click may be followed by one targetless type_text or press_key using its focusReceipt without consuming another surfaceReceipt.",
      requiresExplicitTextMode: true,
      textModes: {
        insert: "Insert at the current caret without clearing existing content.",
        "replace-all": "Atomically focus the grounded editable point, select all existing content, and enter the exact value.",
      },
      coordinateRule: "copy-grounded-editable-interior-point",
      targetBoundsRequired: true,
      targetBoundsRule: "full editable surface rectangle from the same screenshot observation",
      executionPoint: "validated targetBounds center",
      pointSelection: "derive the full editable surface from the screenshot, then use a safe point near its visual center",
      excludedTargets: [
        "action-button row",
        "toolbar icon",
        "label or placeholder glyph",
        "border or resize affordance",
        "dialog, sheet, or other occluding overlay",
      ],
      occlusionRule: "If a dialog, sheet, or overlay covers the intended editable surface, do not type through it. Resolve or dismiss the occlusion, then capture a fresh screenshot.",
      acceptsOcrTextPoint: false,
      requiresVisualGrounding: false,
      verification: "fresh-observation",
    },
  });
});

test("active-controller screenshots and pixel actions share the cua-driver coordinate source", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async captureScreenshot(args) {
        calls.push(args);
        return {
          status: "ok",
          source: "cua-driver-window-state",
          title: "微信",
          path: args.outputPath,
          method: "cua-driver-get_window_state",
          hwnd: 42,
          x: 447,
          y: 144,
          width: 954,
          height: 704,
          window: {
            id: 42,
            title: "微信",
            pid: 1234,
            bounds: { x: 447, y: 144, width: 954, height: 704 },
          },
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: 42,
      windowId: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: -32_000, y: -32_000, width: 146, height: 21 },
    },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };

  const observation = await router.captureWindow({
    titlePart: "微信",
    outputPath: "C:\\controlled\\window.png",
  });

  assert.deepEqual(calls, [{
    window: router.activeController.window,
    outputPath: "C:\\controlled\\window.png",
    timeoutMs: 8_000,
  }]);
  assert.equal(observation.source, "cua-driver-window-state");
  assert.deepEqual(observation.capture, {
    status: "ok",
    source: "cua-driver-window-state",
    title: "微信",
    path: "C:\\controlled\\window.png",
    method: "cua-driver-get_window_state",
    hwnd: 42,
    x: 447,
    y: 144,
    width: 954,
    height: 704,
    window: {
      id: 42,
      title: "微信",
      pid: 1234,
      bounds: { x: 447, y: 144, width: 954, height: 704 },
    },
  });
  assert.deepEqual(observation.window.bounds, {
    x: 447,
    y: 144,
    width: 954,
    height: 704,
  });
  assert.deepEqual(observation.coordinateBounds, {
    x: 0,
    y: 0,
    width: 954,
    height: 704,
  });
  assert.equal(observation.coordinateTransform, "identity");
});

test("router requires an explicit coordinate space and translates screen coordinates", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push(args);
        return { status: "ok", verified: true };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { x: 447, y: 144, width: 954, height: 704 },
    },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = router.createActionObservation({
    observationId: "screen-observation",
    source: "window-capture",
    capture: { x: 447, y: 144, width: 954, height: 704 },
    elements: [],
  });

  await assert.rejects(
    router.act({
      action: {
        kind: "click",
        observationId: "screen-observation",
        x: 500,
        y: 160,
        interactionIntent: "activate-control",
      },
    }),
    (error) => error.code === "action.coordinate_space_required",
  );

  const result = await router.act({
    action: {
      kind: "click",
      observationId: "screen-observation",
      coordinateSpace: "screen",
      x: 500,
      y: 160,
      interactionIntent: "activate-control",
    },
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(calls, [{
    window: router.activeController.window,
    x: 53,
    y: 16,
    deliveryMode: "foreground",
  }]);
});

test("a surface receipt authorizes exactly one action before a fresh observation", async (t) => {
  const router = new ComputerUseProviderRouter({
    driver: {
      async click() {
        return { status: "ok", verified: true };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { x: 0, y: 0, width: 960, height: 720 },
    },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = router.createActionObservation({
    observationId: "single-use-observation",
    source: "window-capture",
    capture: { x: 0, y: 0, width: 960, height: 720 },
    elements: [],
  });
  const surfaceReceiptId = router.lastCapture.surfaceReceipt.id;

  await router.act({
    action: {
      kind: "click",
      observationId: "single-use-observation",
      surfaceReceiptId,
      coordinateSpace: "window-local",
      x: 100,
      y: 100,
      interactionIntent: "activate-control",
    },
  });
  await assert.rejects(
    router.act({
      action: {
        kind: "click",
        observationId: "single-use-observation",
        surfaceReceiptId,
        coordinateSpace: "window-local",
        x: 200,
        y: 100,
        interactionIntent: "activate-control",
      },
    }),
    (error) => error.code === "action.fresh_observation_required",
  );
});

test("an empty semantic probe preserves a fresh unconsumed screenshot receipt", async (t) => {
  const calls = [];
  const now = 1_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: {
      async capture(args) {
        calls.push({ method: "capture", args });
        return {
          observationId: "empty-semantic-probe",
          source: "cua-driver",
          mode: "semantic",
          elements: [],
        };
      },
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", verified: true };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { x: 0, y: 0, width: 960, height: 720 },
    },
    expiresAt: new Date(now + 10_000).toISOString(),
    expiresAtMs: now + 10_000,
  };
  router.lastCapture = router.createActionObservation({
    observationId: "fresh-screenshot",
    source: "window-capture",
    capture: { x: 0, y: 0, width: 960, height: 720 },
    elements: [],
  });
  const originalCapture = router.lastCapture;

  const observed = await router.capture({ mode: "semantic" });

  assert.equal(observed.observationId, "fresh-screenshot");
  assert.equal(observed.surfaceReceipt.id, originalCapture.surfaceReceipt.id);
  assert.equal(observed.semanticProbe.preservedObservationId, "fresh-screenshot");
  assert.equal(observed.perceptionRouting.selectedMode, "semantic-fallback-existing-screenshot");
  assert.equal(router.lastCapture, originalCapture);

  const acted = await router.act({
    action: {
      kind: "click",
      observationId: observed.observationId,
      surfaceReceiptId: observed.surfaceReceipt.id,
      coordinateSpace: "window-local",
      x: 100,
      y: 100,
      interactionIntent: "activate-control",
    },
  });

  assert.equal(acted.status, "ok");
  assert.deepEqual(calls.map((entry) => entry.method), ["capture", "click"]);
});

test("an empty semantic probe cannot reuse a consumed or expired screenshot receipt", async (t) => {
  let now = 1_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: {
      async capture() {
        return {
          observationId: `semantic-${now}`,
          source: "cua-driver",
          mode: "semantic",
          elements: [],
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { x: 0, y: 0, width: 960, height: 720 },
    },
    expiresAt: new Date(now + 300_000).toISOString(),
    expiresAtMs: now + 300_000,
  };
  router.lastCapture = router.createActionObservation({
    observationId: "consumed-screenshot",
    source: "window-capture",
    capture: { x: 0, y: 0, width: 960, height: 720 },
    elements: [],
  });
  router.consumedSurfaceReceiptId = router.lastCapture.surfaceReceipt.id;

  const afterConsumed = await router.capture({ mode: "semantic" });

  assert.equal(afterConsumed.observationId, `semantic-${now}`);
  assert.equal(afterConsumed.semanticProbe, undefined);
  assert.notEqual(afterConsumed.surfaceReceipt.id, router.consumedSurfaceReceiptId);

  router.lastCapture = router.createActionObservation({
    observationId: "expired-screenshot",
    source: "window-capture",
    capture: { x: 0, y: 0, width: 960, height: 720 },
    elements: [],
  });
  now = router.lastCapture.expiresAt + 1;

  const afterExpired = await router.capture({ mode: "semantic" });

  assert.equal(afterExpired.observationId, `semantic-${now}`);
  assert.equal(afterExpired.semanticProbe, undefined);
});

test("router applies screenshot-to-native scaling after pixel admission", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push(args);
        return { status: "ok", verified: true };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { x: 0, y: 0, width: 1_200, height: 900 },
    },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = router.createActionObservation({
    observationId: "scaled-observation",
    source: "window-capture",
    capture: {
      x: 0,
      y: 0,
      width: 960,
      height: 720,
      coordinateScale: {
        schemaVersion: 1,
        sourceSpace: "screenshot-pixel",
        actionSpace: "window-local",
        actionTransform: {
          scaleX: 1.25,
          scaleY: 1.25,
          offsetX: 0,
          offsetY: 0,
        },
      },
    },
    elements: [],
  });

  await router.act({
    action: {
      kind: "click",
      observationId: "scaled-observation",
      coordinateSpace: "window-local",
      x: 340,
      y: 250,
      targetBounds: { x: 320, y: 240, width: 160, height: 80 },
      interactionIntent: "activate-control",
    },
  });

  assert.equal(router.lastCapture.coordinateTransform, "scale-offset");
  assert.equal(calls[0].x, 500);
  assert.equal(calls[0].y, 350);
});

test("provider router dispatches screenshot-grounded text and key actions without semantic elements", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(args) { calls.push({ method: "typeText", args }); return { status: "ok", verified: true }; },
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
      coordinateSpace: "window-local",
      x: 450,
      y: 650,
      targetBounds: { x: 400, y: 600, width: 200, height: 100 },
      value: "hello",
      textMode: "insert",
      deliveryMode: "foreground",
    },
  });
  const pressed = await router.act({
    action: {
      kind: "press_key",
      observationId: "capture-1",
      coordinateSpace: "window-local",
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
        textMode: "insert",
        inputBehavior: "incremental",
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

test("provider router rejects a targetless key action without a live focus receipt", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async pressKey(args) { calls.push(args); return { status: "ok" }; },
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
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  };

  await assert.rejects(
    router.act({
      action: { kind: "press_key", key: "escape", deliveryMode: "foreground" },
    }),
    (error) => error.code === "focus.receipt_required",
  );
  assert.deepEqual(calls, []);
});

test("provider router issues and consumes a short-lived verified focus receipt", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", focus: { verified: true } };
      },
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return { status: "ok", verified: true };
      },
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
    ...observation({ source: "uia", expiresAt: Date.now() + 5_000 }),
    elements: [{
      elementToken: "search-input",
      elementIndex: 0,
      role: "Edit",
      name: "Search",
      actions: ["click", "type_text"],
      source: "uia",
      pixelLimitedAction: false,
    }],
  };

  const clicked = await router.act({
    action: { kind: "click", elementToken: "search-input" },
  });
  assert.equal(clicked.focusReceipt.status, "verified");

  const result = await router.act({
    action: {
      kind: "type_text",
      value: "focused input",
      textMode: "insert",
      focusReceiptId: clicked.focusReceipt.id,
    },
  });

  assert.equal(result.pixelLimitedAction, false);
  assert.equal(result.effectiveDeliveryMode, "foreground");
  assert.deepEqual(calls, [
    {
      method: "click",
      args: {
        window: router.activeController.window,
        elementToken: "search-input",
        elementIndex: undefined,
        deliveryMode: "background",
      },
    },
    {
      method: "typeText",
      args: {
        window: router.activeController.window,
        value: "focused input",
        textMode: "insert",
        inputBehavior: "incremental",
        deliveryMode: "foreground",
      },
    },
  ]);
});

test("provider router permits one screenshot focus continuation and derives targetBounds coordinates", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", focusVerified: true };
      },
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return { status: "ok", verified: true };
      },
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
      observationId: "screenshot-focus-1",
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    coordinateSpace: "window-local",
    surfaceReceipt: {
      id: "surface-focus-1",
      controllerId: "controller-1",
      windowId: "window-1",
      observationId: "screenshot-focus-1",
    },
    elements: [],
  };

  const clicked = await router.act({
    action: {
      kind: "click",
      observationId: "screenshot-focus-1",
      coordinateSpace: "window-local",
      x: 180,
      y: 60,
      targetBounds: { x: 80, y: 40, width: 240, height: 40 },
      interactionIntent: "focus-editable",
      targetRole: "editable",
    },
  });
  assert.equal(clicked.focusReceipt.status, "verified");

  await router.act({
    action: {
      kind: "type_text",
      value: "宋",
      textMode: "replace-all",
      inputBehavior: "incremental",
      focusReceiptId: clicked.focusReceipt.id,
    },
  });

  assert.deepEqual(calls.map((entry) => entry.method), ["click", "typeText"]);
  assert.equal(calls[1].args.value, "宋");
  assert.equal(calls[1].args.deliveryMode, "foreground");
});

test("provider router safely derives observation and focus receipts for the same editable target", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async click(args) {
        calls.push({ method: "click", args });
        return { status: "ok", focusVerified: true };
      },
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return {
          status: "ok",
          verified: false,
          focusVerified: false,
          foregroundWindow: { windowId: "window-1" },
        };
      },
      async pressKey(args) {
        calls.push({ method: "pressKey", args });
        return { status: "ok", verified: true };
      },
      async captureScreenshot({ outputPath }) {
        return {
          status: "ok",
          source: "window-capture",
          path: outputPath,
          artifactBytes: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
            "base64",
          ),
          width: 960,
          height: 720,
          window: { id: "window-1", title: "Fixture", pid: 100, bounds: { width: 960, height: 720 } },
        };
      },
    },
    ocrSession: {
      async start() {},
      async recognize() { return { status: "ok", items: [] }; },
      async close() {},
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
      observationId: "receipt-observation-1",
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    coordinateSpace: "window-local",
    surfaceReceipt: {
      id: "surface-receipt-1",
      controllerId: "controller-1",
      windowId: "window-1",
      observationId: "receipt-observation-1",
    },
    elements: [],
  };

  const bounds = { x: 80, y: 40, width: 240, height: 40 };
  const clicked = await router.act({
    action: {
      kind: "click",
      observationId: "receipt-observation-1",
      surfaceReceiptId: "surface-receipt-1",
      coordinateSpace: "window-local",
      x: 180,
      y: 60,
      targetBounds: bounds,
      interactionIntent: "focus-editable",
      targetRole: "editable",
    },
  });

  router.lastCapture = {
    ...router.lastCapture,
    observationId: "receipt-observation-2",
    surfaceReceipt: {
      id: "surface-receipt-2",
      controllerId: "controller-1",
      windowId: "window-1",
      observationId: "receipt-observation-2",
    },
  };
  await router.act({
    action: {
      kind: "type_text",
      surfaceReceiptId: "surface-receipt-2",
      targetBounds: bounds,
      value: "query",
      textMode: "replace-all",
      inputBehavior: "incremental",
    },
  });
  router.pendingUnverifiedMutation = null;
  await router.act({ action: { kind: "press_key", key: "return" } });

  assert.equal(clicked.focusReceipt.status, "verified");
  assert.deepEqual(calls.map((entry) => entry.method), ["click", "typeText", "pressKey"]);
  assert.equal(calls[1].args.x, 200);
  assert.equal(calls[1].args.y, 60);
  assert.equal(calls[2].args.deliveryMode, "foreground");
});

test("provider router derives a safe window-local center for targetBounds-only text", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(args) {
        calls.push(args);
        return { status: "ok", verified: true };
      },
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
      observationId: "bounds-text-1",
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    coordinateSpace: "window-local",
    elements: [],
  };

  await router.act({
    action: {
      kind: "type_text",
      observationId: "bounds-text-1",
      targetBounds: { x: 80, y: 40, width: 240, height: 40 },
      value: "宋",
      textMode: "replace-all",
      inputBehavior: "incremental",
    },
  });

  assert.equal(calls[0].x, 200);
  assert.equal(calls[0].y, 60);
  assert.equal(calls[0].value, "宋");
});

test("provider router rejects expired or mismatched focus receipts", async (t) => {
  let now = 10_000;
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: {
      async click() { return { status: "ok", focusVerified: true }; },
      async typeText() { return { status: "ok", verified: true }; },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", pid: 100, bounds: { width: 960, height: 720 } },
    expiresAt: new Date(now + 60_000).toISOString(),
    expiresAtMs: now + 60_000,
  };
  router.lastCapture = {
    ...observation({ source: "uia", expiresAt: now + 30_000 }),
    elements: [{
      elementToken: "editor",
      elementIndex: 0,
      role: "Edit",
      actions: ["click", "type_text"],
      source: "uia",
      pixelLimitedAction: false,
    }],
  };

  const clicked = await router.act({ action: { kind: "click", elementToken: "editor" } });
  await assert.rejects(
    router.act({
      action: {
        kind: "type_text",
        value: "text",
        textMode: "insert",
        focusReceiptId: "wrong",
      },
    }),
    (error) => error.code === "focus.receipt_invalid",
  );
  now = clicked.focusReceipt.expiresAtMs + 1;
  await assert.rejects(
    router.act({
      action: {
        kind: "type_text",
        value: "text",
        textMode: "insert",
        focusReceiptId: clicked.focusReceipt.id,
      },
    }),
    (error) => error.code === "focus.receipt_expired",
  );
});

test("possibly-applied text requires a fresh observation before any replay or commit action", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return {
          status: "ok",
          effect: "unverifiable",
          escalation: { recommended: "foreground" },
          verified: false,
        };
      },
      async pressKey(args) {
        calls.push({ method: "pressKey", args });
        return { status: "ok", verified: true };
      },
      async capture() {
        calls.push({ method: "capture" });
        return observation({
          observationId: "obs-after-write",
          source: "uia-som",
          expiresAt: Date.now() + 5_000,
          elements: [],
        });
      },
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
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  };

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      x: 200,
      y: 100,
      targetBounds: { x: 150, y: 70, width: 100, height: 60 },
      value: "possibly landed",
      textMode: "insert",
      deliveryMode: "background",
    },
  });

  assert.equal(typed.status, "indeterminate");
  assert.equal(typed.outcome, "unverified");
  assert.equal(typed.result.effect, "possibly_applied");
  assert.equal(typed.result.replaySafe, false);
  assert.equal(typed.result.escalation, undefined);
  assert.deepEqual(typed.result.recovery, {
    requiresFreshObservation: true,
    sameActionReplayAllowed: false,
    requiredGrounding: "non-occluded-editable-interior",
    pointSelection: "derive-full-editable-surface-then-use-safe-interior-center",
    forbiddenInference: "adjacent-action-button-or-toolbar-icon",
  });
  await assert.rejects(
    router.act({
      action: {
        kind: "press_key",
        observationId: router.lastCapture.observationId,
        coordinateSpace: "window-local",
        x: 200,
        y: 100,
        key: "return",
        deliveryMode: "foreground",
      },
    }),
    (error) => error.code === "action.observation_required_after_unverified_mutation",
  );

  await router.capture({ mode: "semantic" });
  const pressed = await router.act({
    action: {
      kind: "press_key",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      x: 200,
      y: 100,
      key: "return",
      deliveryMode: "foreground",
    },
  });
  assert.equal(pressed.status, "ok");
  assert.deepEqual(calls.map((call) => call.method), ["typeText", "capture", "pressKey"]);
});

test("coordinate text entry returns independently verified focus while mutation still requires observation", async (t) => {
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText() {
        return {
          status: "ok",
          effect: "possibly_applied",
          verified: false,
          focusVerified: true,
          foregroundWindow: {
            windowId: "window-1",
            pid: 100,
            isForeground: true,
          },
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 960, height: 720 },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000,
  };
  router.lastCapture = router.createActionObservation({
    ...observation({
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  });

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      x: 200,
      y: 100,
      value: "瀹嬮箯",
      targetBounds: { x: 150, y: 70, width: 100, height: 60 },
      textMode: "replace-all",
    },
  });

  assert.equal(typed.outcome, "unverified");
  assert.equal(typed.focusReceipt.status, "verified");
  assert.equal(typed.focusReceipt.target.kind, "type_text");
  assert.ok(Date.parse(typed.focusReceipt.expiresAt) - Date.parse(typed.focusReceipt.issuedAt) >= 30_000);
  assert.equal(router.pendingUnverifiedMutation.actionKind, "type_text");
});

test("screenshot target bounds alone atomically ground text entry at the safe center", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(input) {
        calls.push(input);
        return {
          status: "ok",
          effect: "verified",
          verified: true,
          focusVerified: true,
        };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 960, height: 720 },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000,
  };
  router.lastCapture = router.createActionObservation({
    ...observation({
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  });

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      targetBounds: { x: 4, y: 39, width: 403, height: 37 },
      value: "grounded text",
      textMode: "replace-all",
      inputBehavior: "commit",
    },
  });

  assert.equal(typed.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].x, 205.5);
  assert.equal(calls[0].y, 57.5);
  assert.equal(typed.focusReceipt.target.x, 205.5);
  assert.equal(typed.focusReceipt.target.y, 57.5);
});

test("indeterminate pixel text entry automatically returns target-local OCR evidence", async (t) => {
  const captures = [];
  const router = new ComputerUseProviderRouter({
    ocrSession: {},
    driver: {
      async typeText() {
        return {
          status: "ok",
          effect: "possibly_applied",
          verified: false,
          focusVerified: false,
        };
      },
      async captureScreenshot() {
        throw new Error("captureOperation is stubbed by this test");
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 952, height: 722 },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000,
  };
  router.lastCapture = router.createActionObservation({
    ...observation({
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 952, height: 722 },
    }),
    coordinateBounds: { x: 0, y: 0, width: 952, height: 722 },
    elements: [],
  });
  router.captureOperation = async (args) => {
    captures.push(args);
    return {
      observationId: "post-action-observation",
      surfaceReceipt: { id: "post-action-receipt" },
      perceptionRouting: {
        secondaryOcrRegion: { x: 640, y: 0, width: 312, height: 480 },
      },
      localObservation: {
        source: "ocr",
        elements: [{ name: "typed value", observationOnly: true }],
      },
    };
  };

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      x: 580,
      y: 688,
      targetBounds: { x: 348, y: 675, width: 460, height: 26 },
      value: "typed value",
      textMode: "replace-all",
      inputBehavior: "commit",
    },
  });

  assert.equal(captures.length, 1);
  assert.equal(captures[0].mode, "screenshot");
  assert.deepEqual(captures[0].crop, { x: 300, y: 530, width: 556, height: 192 });
  assert.equal(captures[0].includeChangedRegionAlongsideCrop, undefined);
  assert.equal(captures[0].effectHintRegion, undefined);
  assert.equal(typed.capture.observationId, "post-action-observation");
  assert.equal(typed.postActionObservation.source, "host-local-ocr");
  assert.equal(typed.postActionObservation.regionSource, "action-target");
  assert.equal(typed.postActionObservation.effectRegionSource, "changed-region");
  assert.deepEqual(
    typed.postActionObservation.effectRegion,
    { x: 640, y: 0, width: 312, height: 480 },
  );
  assert.deepEqual(
    typed.postActionObservation.verificationRegion,
    { x: 300, y: 530, width: 556, height: 192 },
  );
});

test("fresh exact OCR text promotes coordinate entry without another observe or retry", async (t) => {
  const captures = [];
  const router = new ComputerUseProviderRouter({
    ocrSession: {},
    driver: {
      async typeText() {
        return {
          status: "ok",
          effect: "possibly_applied",
          verified: false,
          focusVerified: false,
        };
      },
      async captureScreenshot() {
        throw new Error("captureOperation is stubbed by this test");
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 952, height: 722 },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000,
  };
  const existingOccurrence = {
    elementToken: "existing-message",
    role: "text",
    name: "typed value",
    value: "typed value",
    source: "ocr",
    bounds: { x: 315, y: 587, width: 153, height: 23 },
  };
  router.lastCapture = router.createActionObservation({
    ...observation({
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 952, height: 722 },
    }),
    coordinateBounds: { x: 0, y: 0, width: 952, height: 722 },
    elements: [existingOccurrence],
  });
  router.captureOperation = async (args) => {
    captures.push(args);
    const observed = router.createActionObservation({
      ...observation({
        observationId: "post-action-exact-value",
        source: "ocr",
        mode: "ocr",
        expiresAt: Date.now() + 5_000,
        capture: { width: 952, height: 722 },
      }),
      coordinateBounds: { x: 0, y: 0, width: 952, height: 722 },
      surfaceReceipt: { id: "post-action-exact-receipt" },
      elements: [
        existingOccurrence,
        {
          elementToken: "new-editor-value",
          role: "text",
          name: "typed value",
          value: "typed value",
          source: "ocr",
          bounds: { x: 350, y: 640, width: 153, height: 23 },
        },
      ],
    });
    router.reconcilePendingTextFocus(observed);
    return observed;
  };

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      targetBounds: { x: 300, y: 660, width: 550, height: 40 },
      value: "typed value",
      textMode: "replace-all",
      inputBehavior: "commit",
    },
  });

  assert.equal(captures.length, 1);
  assert.equal(captures[0].includeChangedRegionAlongsideCrop, undefined);
  assert.equal(typed.status, "ok");
  assert.equal(typed.outcome, "completed");
  assert.equal(typed.result.effect, "verified");
  assert.equal(typed.result.verified, true);
  assert.equal(typed.result.focusVerified, true);
  assert.equal(typed.capture.mutationVerification.status, "confirmed");
  assert.equal(typed.capture.mutationVerification.matchedElementToken, "new-editor-value");
  assert.equal(typed.focusReceipt.status, "verified");
  assert.equal(router.pendingUnverifiedMutation, null);
  assert.match(typed.postActionObservation.nextAction, /Do not observe or type it again/u);
});

test("two unconfirmed mutations block another retry in the same target region", (t) => {
  const router = new ComputerUseProviderRouter();
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 952, height: 722 },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    expiresAtMs: Date.now() + 60_000,
  };
  router.unconfirmedMutationHistory = [
    {
      actionKind: "type_text",
      controllerId: "controller-1",
      windowId: "window-1",
      value: "example",
      target: { x: 580, y: 688, bounds: { x: 348, y: 650, width: 460, height: 52 } },
      atMs: Date.now(),
    },
    {
      actionKind: "type_text",
      controllerId: "controller-1",
      windowId: "window-1",
      value: "example",
      target: { x: 580, y: 670, bounds: { x: 360, y: 640, width: 440, height: 58 } },
      atMs: Date.now(),
    },
  ];

  assert.throws(
    () => router.assertNoRepeatedUnconfirmedMutation({
      kind: "type_text",
      value: "example",
      x: 590,
      y: 676,
      targetBounds: { x: 355, y: 645, width: 450, height: 54 },
    }),
    (error) => {
      assert.equal(error.code, "action.repeated_no_effect");
      assert.equal(error.detail.allowed, false);
      assert.equal(error.detail.pixelLimitedAction, false);
      assert.equal(error.detail.replaySafe, false);
      return true;
    },
  );

  assert.doesNotThrow(() => router.assertNoRepeatedUnconfirmedMutation({
    kind: "type_text",
    value: "different",
    x: 590,
    y: 676,
    targetBounds: { x: 355, y: 645, width: 450, height: 54 },
  }));
  assert.doesNotThrow(() => router.assertNoRepeatedUnconfirmedMutation({
    kind: "type_text",
    value: "example",
    x: 200,
    y: 200,
    targetBounds: { x: 100, y: 150, width: 200, height: 80 },
  }));
});

test("fresh OCR confirmation restores a limited focus continuation after coordinate text entry", async (t) => {
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async typeText(args) {
        calls.push({ method: "typeText", args });
        return {
          status: "ok",
          effect: "possibly_applied",
          verified: false,
        };
      },
      async capture() {
        calls.push({ method: "capture" });
        return observation({
          observationId: "obs-after-unicode-write",
          source: "ocr",
          mode: "ocr",
          expiresAt: Date.now() + 5_000,
          elements: [{
            elementToken: "ocr-written-value",
            role: "text",
            name: "宋鹏",
            value: "宋鹏",
            actions: ["click"],
            source: "ocr",
            bounds: { x: 100, y: 82, width: 42, height: 24 },
            sourceRegion: { x: 100, y: 82, width: 42, height: 24 },
          }],
        });
      },
      async pressKey(args) {
        calls.push({ method: "pressKey", args });
        return { status: "ok", verified: true };
      },
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: {
      id: "window-1",
      windowId: "window-1",
      title: "Fixture",
      pid: 100,
      bounds: { width: 960, height: 720 },
    },
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    expiresAtMs: Date.now() + 10_000,
  };
  router.lastCapture = router.createActionObservation({
    ...observation({
      source: "window-capture",
      expiresAt: Date.now() + 5_000,
      capture: { width: 960, height: 720 },
    }),
    elements: [],
  });

  const typed = await router.act({
    action: {
      kind: "type_text",
      observationId: router.lastCapture.observationId,
      coordinateSpace: "window-local",
      x: 200,
      y: 100,
      value: "宋鹏",
      targetBounds: { x: 150, y: 70, width: 100, height: 60 },
      textMode: "replace-all",
    },
  });
  assert.equal(typed.outcome, "unverified");

  const observed = await router.capture({ mode: "semantic" });
  assert.equal(observed.mutationVerification.status, "confirmed");
  assert.equal(observed.mutationVerification.method, "exact-observed-value-near-grounded-target");
  assert.equal(observed.focusReceipt.status, "verified");
  assert.equal(router.pendingUnverifiedMutation, null);

  const pressed = await router.act({
    action: {
      kind: "press_key",
      key: "return",
      focusReceiptId: observed.focusReceipt.id,
    },
  });
  assert.equal(pressed.status, "ok");
  assert.deepEqual(calls.map((call) => call.method), ["typeText", "capture", "pressKey"]);
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
