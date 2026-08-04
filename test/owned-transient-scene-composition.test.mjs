import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composeOwnedTransientSceneElements,
  composeSameWindowNavigationSceneElements,
  detectSameWindowNavigationSurfaceFromPixels,
} from "../src/owned-transient-scene-composition.mjs";
import { admitPerceptionAction } from "../src/perception-action-admission.mjs";

const mainCapture = {
  hwnd: "42",
  windowId: "42",
  x: 452,
  y: 100,
  width: 954,
  height: 724,
};

const searchControl = {
  role: "search",
  bounds: { x: 72, y: 41, width: 180, height: 28 },
  state: { focused: true },
};

const navigationControl = {
  role: "button",
  bounds: { x: 24, y: 650, width: 42, height: 42 },
};

function surface(overrides = {}) {
  return {
    status: "ok",
    hwnd: "77",
    ownerWindowId: "42",
    title: "",
    screenshotId: "screenshot-1",
    x: 501,
    y: 163,
    width: 368,
    height: 352,
    surfaceProvenance: {
      relationshipVerified: true,
      relationship: "owned-window",
      requestedWindowId: "42",
      relatedWindowId: "77",
      requestedProcessId: 1234,
      relatedProcessId: 1234,
      ownerWindowId: "42",
    },
    coordinateScale: {
      actionTransform: { scaleX: 1, scaleY: 1, offsetX: 49, offsetY: 63 },
      nativeToObservation: { scaleX: 1, scaleY: 1 },
    },
    ocrElements: [{
      source: "ocr",
      name: "联系人",
      confidence: 0.99,
      bounds: { x: 12, y: 10, width: 52, height: 20 },
    }, {
      source: "ocr",
      name: "联系人甲",
      confidence: 0.99,
      bounds: { x: 58, y: 63, width: 72, height: 22 },
    }, {
      source: "ocr",
      name: "1",
      confidence: 0.82,
      bounds: { x: 340, y: 64, width: 8, height: 18 },
    }, {
      source: "ocr",
      name: "包含联系人乙(微信号: sample_1219)、",
      confidence: 0.98,
      bounds: { x: 56, y: 158, width: 210, height: 18 },
    }, {
      source: "ocr",
      name: "联系人甲",
      confidence: 0.99,
      bounds: { x: 272, y: 158, width: 62, height: 18 },
    }],
    visualProposals: [{
      proposalId: "header",
      confidence: 0.94,
      bounds: { x: 8, y: 7, width: 76, height: 27 },
    }, {
      proposalId: "direct-contact-row",
      confidence: 0.94,
      bounds: { x: 48, y: 52, width: 312, height: 44 },
    }, {
      proposalId: "group-subtitle",
      confidence: 0.94,
      bounds: { x: 48, y: 150, width: 294, height: 32 },
    }],
    ...overrides,
  };
}

test("owned related screenshot composes a search-results surface and one exact direct candidate", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface()],
  });

  const ownedWindow = elements.find((element) => element.hostType === "Window");
  const transient = elements.find((element) => element.hostType === "TransientSurface");
  const candidates = elements.filter((element) => element.role === "search-result");
  assert.equal(ownedWindow.parentSceneRoot, true);
  assert.equal(transient.parentElementToken, ownedWindow.elementToken);
  assert.equal(candidates.filter((candidate) => candidate.name === "联系人甲").length, 1);
  assert.equal(candidates.some((candidate) => candidate.name.includes("包含联系人乙")), true);
  assert.equal(
    candidates.find((candidate) => candidate.name === "联系人甲").semanticKey,
    "conversation:联系人甲",
  );
  assert.deepEqual(candidates.find((candidate) => candidate.name === "联系人甲").coordinate, {
    screenshotId: "screenshot-1",
    windowId: "77",
    space: "window-local",
    cropOffset: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    actionWindowId: "42",
    actionTransform: { scaleX: 1, scaleY: 1, offsetX: 49, offsetY: 63 },
  });
});

test("unproven or geometrically detached related surfaces never become actionable", () => {
  assert.deepEqual(composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({ surfaceProvenance: { relationshipVerified: false } })],
  }), []);
  assert.deepEqual(composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({ x: 1000, y: 700 })],
  }), []);
});

test("same-process auxiliary screenshots retain their relationship type in the Scene", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({
      ownerWindowId: null,
      surfaceProvenance: {
        relationshipVerified: true,
        relationship: "same-process-auxiliary",
        requestedWindowId: "42",
        relatedWindowId: "77",
        requestedProcessId: 1234,
        relatedProcessId: 1234,
        ownerWindowId: null,
      },
    })],
  });

  const auxiliary = elements.find((element) => element.hostType === "Window");
  assert.equal(auxiliary.role, "same-process-auxiliary-window");
  assert.equal(elements.some((element) => element.role === "search-results"), true);
  assert.equal(elements.some((element) => element.role === "search-result"), true);
});

test("a full-size same-process auxiliary window is not assigned to a search control", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({
      ownerWindowId: null,
      x: 402,
      y: 164,
      width: 916,
      height: 568,
      surfaceProvenance: {
        relationshipVerified: true,
        relationship: "same-process-auxiliary",
        requestedWindowId: "42",
        relatedWindowId: "77",
        requestedProcessId: 1234,
        relatedProcessId: 1234,
        ownerWindowId: null,
      },
    })],
  });

  assert.deepEqual(elements, []);
});

test("relationship and geometry compose a popup even after the focus receipt is consumed", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl: { ...searchControl, value: "", state: { focused: false } },
    surfaces: [surface()],
  });

  assert.equal(elements.some((element) => element.role === "search-results"), true);
  assert.equal(elements.some((element) => element.role === "search-result"), true);
});

test("an exact non-empty search remains active after its short-lived focus receipt is consumed", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl: {
      ...searchControl,
      value: "Exact query",
      state: { focused: false },
    },
    surfaces: [surface()],
  });

  assert.equal(elements.some((element) => element.role === "search-results"), true);
  assert.equal(elements.some((element) => element.role === "search-result"), true);
});

test("OCR without an independent visual owner cannot create a search result", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({ visualProposals: [] })],
  });
  assert.equal(elements.some((element) => element.role === "search-result"), false);
  assert.equal(elements.some((element) => element.role === "search-results"), true);
});

test("a proven related popup near a navigation control becomes one generic owned navigation surface", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    navigationControl,
    surfaces: [surface({
      x: 452,
      y: 470,
      width: 240,
      height: 180,
      ocrElements: [{
        source: "ocr",
        name: "Settings",
        confidence: 0.99,
        bounds: { x: 52, y: 112, width: 78, height: 22 },
      }],
      visualProposals: [{
        proposalId: "settings-row",
        confidence: 0.96,
        bounds: { x: 24, y: 100, width: 190, height: 44 },
      }],
      coordinateScale: {
        actionTransform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 370 },
        nativeToObservation: { scaleX: 1, scaleY: 1 },
      },
    })],
  });

  const ownedWindow = elements.find((element) => element.hostType === "Window");
  const transient = elements.find((element) => element.role === "navigation-surface");
  const item = elements.find((element) => element.role === "navigation-item");
  assert.equal(transient.parentElementToken, ownedWindow.elementToken);
  assert.equal(item.parentElementToken, transient.elementToken);
  assert.equal(item.name, "Settings");
  assert.equal(item.semanticKey, "navigation:settings");
  assert.deepEqual(item.actions, ["click"]);
});

test("a proven auxiliary window detached from the navigation control is not assigned to it", () => {
  assert.deepEqual(composeOwnedTransientSceneElements({
    mainCapture,
    navigationControl,
    surfaces: [surface({ x: 1200, y: 700, width: 180, height: 120 })],
  }), []);
});

test("a changed same-window popup near its navigation anchor composes one grounded navigation item", () => {
  const elements = composeSameWindowNavigationSceneElements({
    mainCapture: {
      ...mainCapture,
      screenshotId: "main-screenshot-2",
      coordinateScale: {
        actionTransform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
        nativeToObservation: { scaleX: 1, scaleY: 1 },
      },
    },
    navigationControl,
    changedRegion: { x: 8, y: 450, width: 238, height: 190 },
    ocrElements: [{
      source: "ocr",
      name: "Settings",
      confidence: 0.99,
      bounds: { x: 52, y: 552, width: 78, height: 22 },
    }],
    visualProposals: [{
      proposalId: "settings-row",
      confidence: 0.96,
      bounds: { x: 24, y: 540, width: 190, height: 44 },
    }],
  });

  const transient = elements.find((element) => element.role === "navigation-surface");
  const item = elements.find((element) => element.role === "navigation-item");
  assert.equal(transient.parentSceneRoot, true);
  assert.equal(item.parentElementToken, transient.elementToken);
  assert.equal(item.name, "Settings");
  assert.deepEqual(item.actions, ["click"]);
  assert.equal(item.coordinate.screenshotId, "main-screenshot-2");
  assert.equal(item.coordinate.windowId, "42");

  // A row offered with a click action has to be admissible, otherwise the Agent
  // is invited to select something the Host will always refuse. It is a pixel
  // target and says so, and it carries what a pixel target must carry.
  assert.equal(item.pixelLimitedAction, true);
  assert.equal(item.source, "local-proposal-fusion");
  assert.equal(item.guessedAction, false);
  assert.ok(item.sourceRegion, "carries the region it was recognised in");
  assert.equal(typeof item.proposalId, "string");
  assert.equal(typeof item.modelIdentity?.provider, "string");
  const providers = new Set(item.support.map((entry) => entry.provider));
  assert.equal(providers.size, 2, "two independent providers, not OCR alone");
  assert.ok(providers.has("ocr"), "one of them reads the label");
  assert.ok(
    providers.has("visual-structure") || providers.has("som-proposal"),
    "the other one finds the row without reading it",
  );
  assert.ok(item.confidence >= 0.98, `fused confidence ${item.confidence} clears the pixel-target bar`);
});

test("a composed navigation item is admitted for the click it advertises", () => {
  const elements = composeSameWindowNavigationSceneElements({
    mainCapture: { ...mainCapture, screenshotId: "main-screenshot-3" },
    navigationControl,
    changedRegion: { x: 8, y: 450, width: 238, height: 190 },
    ocrElements: [{
      source: "ocr",
      name: "Settings",
      confidence: 0.99,
      bounds: { x: 52, y: 552, width: 78, height: 22 },
    }],
    visualProposals: [{
      proposalId: "settings-row",
      confidence: 0.96,
      bounds: { x: 24, y: 540, width: 190, height: 44 },
    }],
  });
  const item = elements.find((element) => element.role === "navigation-item");

  const decision = admitPerceptionAction({
    observation: {
      includeUserOverlay: false,
      observationId: "obs-1",
      source: "screenshot",
      controllerId: "controller-1",
      window: { id: "42" },
    },
    element: item,
    action: { kind: "click", elementId: item.elementToken, controllerId: "controller-1", windowId: "42" },
    now: 100,
  });

  assert.equal(decision.allowed, true, JSON.stringify(decision));
  assert.equal(decision.pixelLimitedAction, true, "the click is reported as pixel-limited, not semantic");
});

test("same-window navigation composition rejects detached changes and OCR-only rows", () => {
  const common = {
    mainCapture: { ...mainCapture, screenshotId: "main-screenshot-2" },
    navigationControl,
    changedRegion: { x: 8, y: 450, width: 238, height: 190 },
    ocrElements: [{
      source: "ocr",
      name: "Settings",
      confidence: 0.99,
      bounds: { x: 52, y: 552, width: 78, height: 22 },
    }],
  };
  assert.deepEqual(composeSameWindowNavigationSceneElements(common), []);
  assert.deepEqual(composeSameWindowNavigationSceneElements({
    ...common,
    changedRegion: { x: 700, y: 100, width: 200, height: 160 },
    visualProposals: [{
      proposalId: "detached-row",
      confidence: 0.96,
      bounds: { x: 720, y: 120, width: 160, height: 44 },
    }],
  }), []);
});

test("an anchor-local flat popup surface grounds row owners for stable-frame OCR", () => {
  const previousPixels = flatPixels(954, 724, [224, 232, 238]);
  const pixels = flatPixels(954, 724, [224, 232, 238]);
  paintFlatRect(pixels, { x: 8, y: 440, width: 238, height: 190 }, [253, 253, 254]);
  const detected = detectSameWindowNavigationSurfaceFromPixels({
    pixels,
    previousPixels,
    navigationControl,
    ocrElements: [{
      source: "ocr",
      name: "50",
      confidence: 0.99,
      bounds: { x: 20, y: 447, width: 24, height: 18 },
    }, {
      source: "ocr",
      name: "Usage",
      confidence: 0.99,
      bounds: { x: 20, y: 470, width: 54, height: 20 },
    }, {
      source: "ocr",
      name: "Settings",
      confidence: 0.99,
      bounds: { x: 20, y: 525, width: 78, height: 20 },
    }, {
      source: "ocr",
      name: "Sign out",
      confidence: 0.99,
      bounds: { x: 20, y: 580, width: 72, height: 20 },
    }],
  });

  assert.deepEqual(detected.bounds, { x: 8, y: 440, width: 238, height: 190 });
  assert.deepEqual(detected.ocrElements.map((element) => element.name), [
    "Usage",
    "Settings",
    "Sign out",
  ]);
  assert.equal(detected.visualProposals.length, 3);
  assert.ok(detected.visualProposals.every((proposal) => proposal.source === "visual-structure"));
  assert.equal(detected.support.transitionVerified, true);
  assert.ok(detected.support.appearanceChangeRatio >= 0.45);
});

test("a persistent pane inside a broad dirty region cannot become a remembered transient surface", () => {
  const paneBounds = { x: 0, y: 80, width: 270, height: 612 };
  const previousPixels = flatPixels(954, 724, [224, 232, 238]);
  paintFlatRect(previousPixels, paneBounds, [253, 253, 254]);
  const pixels = {
    ...previousPixels,
    data: new Uint8ClampedArray(previousPixels.data),
  };
  // Live content inside the persistent pane changed, so a coarse dirty box
  // overlaps it, but the pane itself did not appear in this transition.
  paintFlatRect(pixels, { x: 20, y: 440, width: 100, height: 40 }, [235, 235, 236]);
  const rows = [
    { source: "ocr", name: "Project A", confidence: 0.99, bounds: { x: 20, y: 470, width: 82, height: 20 } },
    { source: "ocr", name: "Project B", confidence: 0.99, bounds: { x: 20, y: 525, width: 82, height: 20 } },
    { source: "ocr", name: "Project C", confidence: 0.99, bounds: { x: 20, y: 580, width: 82, height: 20 } },
  ];

  assert.equal(detectSameWindowNavigationSurfaceFromPixels({
    pixels,
    previousPixels,
    navigationControl,
    changedRegion: { x: 0, y: 400, width: 600, height: 300 },
    ocrElements: rows,
  }), null);
});

test("a compact anchored menu already open in both frames remains observable without claiming a transition", () => {
  const menuBounds = { x: 8, y: 440, width: 238, height: 190 };
  const previousPixels = flatPixels(954, 724, [224, 232, 238]);
  paintFlatRect(previousPixels, menuBounds, [253, 253, 254]);
  const pixels = {
    ...previousPixels,
    data: new Uint8ClampedArray(previousPixels.data),
  };
  const detected = detectSameWindowNavigationSurfaceFromPixels({
    pixels,
    previousPixels,
    navigationControl,
    ocrElements: [
      { source: "ocr", name: "Usage", confidence: 0.99, bounds: { x: 20, y: 470, width: 54, height: 20 } },
      { source: "ocr", name: "Settings", confidence: 0.99, bounds: { x: 20, y: 525, width: 78, height: 20 } },
      { source: "ocr", name: "Sign out", confidence: 0.99, bounds: { x: 20, y: 580, width: 72, height: 20 } },
    ],
  });

  assert.deepEqual(detected.bounds, menuBounds);
  assert.equal(detected.support.transitionVerified, false);
  assert.equal(detected.support.compactAnchoredSurface, true);
  assert.equal(detected.support.stableAnchorOwnership, true);
});

test("a static compact editor near but not owned by the navigation anchor is rejected", () => {
  const editorBounds = { x: 145, y: 620, width: 290, height: 82 };
  const previousPixels = flatPixels(954, 724, [224, 232, 238]);
  paintFlatRect(previousPixels, editorBounds, [253, 253, 254]);
  const pixels = {
    ...previousPixels,
    data: new Uint8ClampedArray(previousPixels.data),
  };

  assert.equal(detectSameWindowNavigationSurfaceFromPixels({
    pixels,
    previousPixels,
    navigationControl,
    ocrElements: [
      { source: "ocr", name: "Draft", confidence: 0.99, bounds: { x: 165, y: 640, width: 54, height: 20 } },
      { source: "ocr", name: "Model", confidence: 0.99, bounds: { x: 165, y: 672, width: 54, height: 20 } },
    ],
  }), null);
});

test("an already-open popup survives the frame going static", () => {
  // A menu stops changing the moment it finishes opening. Requiring it to
  // overlap the changed region on every frame drops it from the Scene while it
  // is still on screen, and every candidate it contributed goes stale.
  const menuBounds = { x: 8, y: 440, width: 238, height: 190 };
  const rows = [
    { source: "ocr", name: "Usage", confidence: 0.99, bounds: { x: 20, y: 470, width: 54, height: 20 } },
    { source: "ocr", name: "Settings", confidence: 0.99, bounds: { x: 20, y: 525, width: 78, height: 20 } },
    { source: "ocr", name: "Sign out", confidence: 0.99, bounds: { x: 20, y: 580, width: 72, height: 20 } },
  ];
  const capture = (extra) => {
    const pixels = flatPixels(954, 724, [224, 232, 238]);
    paintFlatRect(pixels, menuBounds, [253, 253, 254]);
    return detectSameWindowNavigationSurfaceFromPixels({
      pixels,
      navigationControl,
      ocrElements: rows,
      // Something unrelated changed far away; the open menu did not.
      changedRegion: { x: 700, y: 60, width: 120, height: 40 },
      ...extra,
    });
  };

  assert.equal(capture({}), null, "an unproven surface still needs the change to admit it");
  const carried = capture({ knownSurfaceBounds: menuBounds });
  assert.ok(carried, "a surface already proven open is not required to prove it again");
  assert.deepEqual(carried.bounds, menuBounds);
  assert.deepEqual(carried.ocrElements.map((element) => element.name), ["Usage", "Settings", "Sign out"]);

  // Carrying forward must not resurrect a surface somewhere else entirely.
  assert.equal(
    capture({ knownSurfaceBounds: { x: 600, y: 80, width: 200, height: 160 } }),
    null,
    "a remembered surface only admits the surface it actually describes",
  );
});

test("an adjacent visual avatar grounds one row without absorbing a distant accessory", () => {
  const elements = composeOwnedTransientSceneElements({
    mainCapture,
    searchControl,
    surfaces: [surface({
      ocrElements: [{
        elementToken: "ocr-name",
        role: "text",
        name: "Exact contact",
        source: "ocr",
        confidence: 0.99,
        bounds: { x: 74, y: 61, width: 96, height: 23 },
      }, {
        elementToken: "ocr-accessory",
        role: "text",
        name: "1",
        source: "ocr",
        confidence: 0.98,
        bounds: { x: 305, y: 59, width: 30, height: 26 },
      }],
      visualProposals: [{
        proposalId: "avatar",
        confidence: 0.94,
        bounds: { x: 36, y: 54, width: 36, height: 36 },
      }],
    })],
  });

  const result = elements.find((element) => element.role === "search-result");
  assert.equal(result.name, "Exact contact");
  assert.deepEqual(result.bounds, { x: 36, y: 54, width: 134, height: 36 });
  assert.deepEqual(result.actions, ["click"]);
});

function flatPixels(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function paintFlatRect(image, bounds, color) {
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
    }
  }
}
