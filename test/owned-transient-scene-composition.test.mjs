import assert from "node:assert/strict";
import { test } from "node:test";

import { composeOwnedTransientSceneElements } from "../src/owned-transient-scene-composition.mjs";

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
