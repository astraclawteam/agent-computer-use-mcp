import assert from "node:assert/strict";
import test from "node:test";

import {
  composeMessagingSceneElements,
  deduplicateVisualProposals,
  detectControlSurfaceFromPixels,
  stableCompositionOcrElements,
} from "../src/messaging-scene-composition.mjs";
import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";

const bounds = { x: 0, y: 0, width: 960, height: 720 };
const searchOcr = {
  elementToken: "ocr-search",
  role: "text",
  name: "搜索",
  value: "搜索",
  bounds: { x: 90, y: 44, width: 42, height: 23 },
  confidence: 0.99,
  source: "ocr",
  proposalId: "ocr-search",
};
const searchSurface = {
  proposalId: "visual-search",
  role: "region",
  bounds: { x: 76, y: 38, width: 178, height: 36 },
  confidence: 0.94,
  source: "som-proposal",
};

test("OCR alone cannot create an actionable search editable", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [searchOcr],
    visualProposals: [],
  });

  assert.deepEqual(result.elements, []);
  assert.deepEqual(result.knownControls, []);
  assert.deepEqual(result.diagnostics, {
    ocrCount: 1,
    visualProposalCount: 0,
    semanticControlLabelCount: 1,
    matchedControlCount: 0,
    conflictCount: 0,
  });
});

test("stable composition can retain non-duplicate full-window OCR without exposing it as current OCR", () => {
  const local = {
    ...searchOcr,
    elementToken: "ocr-local",
    name: "状态",
    value: "状态",
    bounds: { x: 500, y: 500, width: 36, height: 20 },
  };

  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [local],
    previousElements: [searchOcr],
    visualSceneStable: true,
  }), [local, searchOcr]);
  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [local],
    previousElements: [searchOcr],
    visualSceneStable: false,
  }), [local]);
});

test("stable composition deduplicates the same OCR occurrence", () => {
  const refreshedSearch = { ...searchOcr, elementToken: "ocr-search-refreshed" };
  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [refreshedSearch],
    previousElements: [searchOcr],
    visualSceneStable: true,
  }), [refreshedSearch]);
});

test("pixel evidence finds the enclosing control surface instead of reusing OCR glyph bounds", () => {
  const image = solidImage(320, 120, 240);
  fillRect(image, { x: 76, y: 38, width: 178, height: 36 }, 255);
  fillRect(image, searchOcr.bounds, 20);

  assert.deepEqual(
    detectControlSurfaceFromPixels(image, searchOcr.bounds),
    { x: 76, y: 38, width: 178, height: 36 },
  );
});

test("pixel evidence samples just inside a rounded surface when wider offsets miss it", () => {
  const image = solidImage(320, 120, 230);
  const shallowSurface = { x: 76, y: 42, width: 178, height: 27 };
  fillRect(image, shallowSurface, 255);
  fillRect(image, searchOcr.bounds, 20);

  assert.deepEqual(
    detectControlSurfaceFromPixels(image, searchOcr.bounds),
    shallowSurface,
  );
});

test("pixel evidence accepts a shallow control with three grounded vertical padding pixels", () => {
  const image = solidImage(320, 120, 230);
  const shallowSurface = { x: 77, y: 42, width: 170, height: 26 };
  fillRect(image, shallowSurface, 250);
  fillRect(image, searchOcr.bounds, 20);

  assert.deepEqual(
    detectControlSurfaceFromPixels(image, searchOcr.bounds),
    shallowSurface,
  );
});

test("pixel evidence composes a focused outline only from matching top and bottom edges", () => {
  const image = solidImage(320, 120, 230);
  fillRect(image, { x: 78, y: 41, width: 168, height: 1 }, 100);
  fillRect(image, { x: 78, y: 68, width: 168, height: 1 }, 100);
  fillRect(image, { x: 98, y: 49, width: 28, height: 11 }, 20);
  const focusedOcr = {
    ...searchOcr.bounds,
    x: 89,
    y: 42,
    width: 44,
    height: 27,
  };

  assert.deepEqual(
    detectControlSurfaceFromPixels(image, focusedOcr),
    { x: 78, y: 41, width: 168, height: 28 },
  );
});

test("near-duplicate SOM candidates retain the complete pixel-grounded semantic surface", () => {
  const truncated = {
    proposalId: "som-truncated",
    bounds: { x: 77, y: 42, width: 170, height: 24 },
  };
  const grounded = {
    proposalId: "semantic-surface-1",
    bounds: { x: 77, y: 42, width: 170, height: 26 },
  };

  assert.deepEqual(deduplicateVisualProposals([truncated, grounded]), [grounded]);
});

test("one independent visual surface plus owned OCR creates a search parent and editable", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [searchOcr],
    visualProposals: [searchSurface],
  });

  assert.equal(result.elements.length, 2);
  const parent = result.elements.find((element) => element.role === "search-container");
  const search = result.elements.find((element) => element.role === "search");
  assert.ok(parent);
  assert.ok(search);
  assert.equal(search.parentElementToken, parent.elementToken);
  assert.equal(search.value, "");
  assert.deepEqual(search.actions, ["click", "type_text"]);
  assert.equal(search.source, "local-proposal-fusion");
  assert.equal(search.confidence >= 0.98, true);
  assert.deepEqual(search.support.map((entry) => entry.provider).sort(), ["ocr", "som-proposal"]);
  assert.deepEqual(search.sourceRegion, searchSurface.bounds);
  assert.deepEqual(result.knownControls, [{
    role: "search",
    bounds: searchSurface.bounds,
    semanticKey: "control:search",
  }]);
  assert.equal(result.diagnostics.matchedControlCount, 1);
});

test("the real shallow search geometry is owned consistently after pixel detection", () => {
  const groundedSurface = {
    ...searchSurface,
    proposalId: "semantic-surface-1",
    bounds: { x: 77, y: 42, width: 170, height: 26 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [searchOcr],
    visualProposals: [groundedSurface],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.deepEqual(search.bounds, groundedSurface.bounds);
  assert.equal(search.evidenceConsistency, undefined);
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("a verified focused outline with one padding pixel can own the search OCR", () => {
  const focusedOcr = {
    ...searchOcr,
    bounds: { x: 89, y: 42, width: 44, height: 27 },
  };
  const focusedOutline = {
    ...searchSurface,
    proposalId: "semantic-surface-1",
    bounds: { x: 78, y: 41, width: 168, height: 28 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [focusedOcr],
    visualProposals: [focusedOutline],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.deepEqual(search.bounds, focusedOutline.bounds);
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("two materially different visual owners create a conflict with no actions", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [searchOcr],
    visualProposals: [
      searchSurface,
      { ...searchSurface, proposalId: "visual-other", bounds: { x: 70, y: 30, width: 230, height: 54 } },
    ],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.ok(search);
  assert.equal(search.evidenceConsistency, "conflict");
  assert.deepEqual(search.conflicts, ["bounds"]);
  assert.deepEqual(search.actions, []);
  assert.deepEqual(result.knownControls, []);
});

test("a remembered search role survives replacement text only with matching fresh visual evidence", () => {
  const queryOcr = { ...searchOcr, name: "林舟", value: "林舟", proposalId: "ocr-query" };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [queryOcr],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
    focusedTarget: { bounds: searchSurface.bounds },
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "林舟");
  assert.equal(search.state.focused, true);
  assert.equal(search.semanticKey, "control:search");
});

test("a remembered control selects the closest fresh visual-owner cluster", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{ ...searchOcr, name: "林舟", value: "林舟" }],
    visualProposals: [
      { ...searchSurface, proposalId: "closest" },
      {
        ...searchSurface,
        proposalId: "same-provider-outer-scale",
        bounds: { x: 70, y: 32, width: 220, height: 50 },
      },
    ],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.evidenceConsistency, undefined);
  assert.deepEqual(search.bounds, searchSurface.bounds);
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("the production screenshot composition adds only the fused search control to Host Scene", async (t) => {
  const router = new ComputerUseProviderRouter({
    messagingVisualProposalOperation: async () => [searchSurface],
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", bounds },
    expiresAtMs: Date.now() + 60_000,
  };
  router.readOwnedArtifact = async () => Buffer.from("fixture-pixels");
  router.ocrRegionOperation = async () => ({
    observation: {
      source: "ocr",
      elements: [searchOcr],
    },
  });

  const observation = await router.runOperation((ticket) => (
    router.prioritizeLocalScreenshotPerception({
      observationId: "shot-1",
      artifact: { path: "C:\\owned\\shot.png" },
      capture: { width: bounds.width, height: bounds.height },
      coordinateSpace: "window-local",
      coordinateBounds: bounds,
      window: { id: "window-1", bounds },
      includeUserOverlay: false,
    }, {
      visualQuestion: "Identify the search editable from Host-owned candidates.",
    }, ticket)
  ));
  const actionObservation = router.createActionObservation(observation);
  const search = actionObservation.scene.elements.find((element) => element.role === "search");
  const parent = actionObservation.scene.elements.find((element) => element.role === "search-container");
  const ocr = actionObservation.scene.elements.find((element) => element.name === "搜索");

  assert.equal(search.type, "Editable");
  assert.equal(search.parentId, parent.id);
  assert.deepEqual(search.actions, ["click", "type_text"]);
  assert.equal(ocr.evidenceConsistency, "insufficient");
  assert.deepEqual(ocr.actions, []);
});

function solidImage(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function fillRect(image, rect, value) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
    }
  }
}
