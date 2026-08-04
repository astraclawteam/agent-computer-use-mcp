import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHostScene,
  buildRegionOwnedScene,
  resolveHostSceneElement,
} from "../src/scene-region-ownership.mjs";

const screenshot = {
  id: "shot-1",
  windowId: "window-1",
  observationVersion: 7,
  coordinateSpace: "window-local",
  bounds: { x: 0, y: 0, width: 1200, height: 800 },
  cropOffset: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
};

const regions = [
  { id: "search", role: "editable", bounds: { x: 10, y: 10, width: 280, height: 40 } },
  { id: "dropdown", role: "transient-surface", bounds: { x: 10, y: 55, width: 280, height: 180 } },
  { id: "history", role: "container", bounds: { x: 0, y: 240, width: 320, height: 560 } },
  { id: "chat", role: "container", bounds: { x: 320, y: 0, width: 880, height: 800 } },
];

test("scene values and OCR tokens remain owned by their observed region", () => {
  const scene = buildRegionOwnedScene({
    screenshot,
    regions,
    evidence: [
      { claimId: "query", source: "ocr", regionId: "search", text: "张三", bounds: { x: 30, y: 18, width: 60, height: 22 } },
      { claimId: "candidate", source: "ocr", regionId: "dropdown", text: "张三", bounds: { x: 35, y: 75, width: 60, height: 22 } },
      { claimId: "history-text", source: "ocr", regionId: "history", text: "张三", bounds: { x: 35, y: 280, width: 60, height: 22 } },
      { claimId: "chat-text", source: "ocr", regionId: "chat", text: "张三", bounds: { x: 500, y: 300, width: 60, height: 22 } },
    ],
  });

  assert.equal(scene.regionValues.search, "张三");
  assert.equal(scene.elements.filter((element) => element.parentId === "search").length, 1);
  assert.equal(scene.elements.filter((element) => element.parentId === "dropdown").length, 1);
  assert.equal(scene.elements.filter((element) => element.parentId === "history").length, 1);
  assert.equal(scene.elements.filter((element) => element.parentId === "chat").length, 1);
  assert.equal(scene.elements.every((element) => element.screenshotId === "shot-1"), true);
  assert.equal(scene.elements.every((element) => element.windowId === "window-1"), true);
  assert.equal(scene.elements.every((element) => element.coordinateSpace === "window-local"), true);
});

test("cross-region and cross-source conflicts suppress every executable action", () => {
  const scene = buildRegionOwnedScene({
    screenshot,
    regions,
    evidence: [
      {
        claimId: "target-1",
        source: "structure",
        regionId: "dropdown",
        role: "actionable-item",
        text: "候选项",
        bounds: { x: 20, y: 70, width: 220, height: 36 },
        actions: ["click"],
      },
      {
        claimId: "target-1",
        source: "visual",
        regionId: "chat",
        role: "chat-message",
        text: "候选项",
        bounds: { x: 500, y: 300, width: 220, height: 36 },
        actions: ["click"],
      },
    ],
  });

  const target = scene.elements.find((element) => element.id === "target-1");
  assert.equal(target.evidenceConsistency, "conflict");
  assert.deepEqual(target.actions, []);
  assert.equal(target.actionable, false);
  assert.deepEqual(target.conflicts.sort(), ["bounds", "parent", "role"]);
});

test("evidence outside its declared parent is rejected instead of reassigned", () => {
  assert.throws(() => buildRegionOwnedScene({
    screenshot,
    regions,
    evidence: [{
      claimId: "pollution",
      source: "ocr",
      regionId: "search",
      text: "聊天正文",
      bounds: { x: 600, y: 400, width: 120, height: 30 },
    }],
  }), { code: "scene.evidence_outside_parent" });
});

test("Host Scene is the single versioned ownership model for semantic and OCR evidence", () => {
  const scene = buildHostScene({
    observationVersion: 11,
    observation: {
      observationId: "observation-11",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 1200, height: 800 },
      coordinateScale: {
        actionTransform: { scaleX: 1.25, scaleY: 1.25, offsetX: 4, offsetY: 8 },
      },
      surfaceReceipt: {
        generation: 11,
        screenshotId: "screenshot-11",
        windowId: "window-1",
      },
      window: { id: "window-1", title: "Fixture", bounds: { width: 1200, height: 800 } },
      elements: [{
        elementToken: "search",
        role: "editable",
        name: "Search",
        source: "uia-som",
        bounds: { x: 10, y: 10, width: 280, height: 40 },
        actions: ["set_value", "click"],
      }],
      localObservation: {
        elements: [{
          elementToken: "ocr-query",
          role: "text",
          name: "张三",
          source: "ocr",
          bounds: { x: 30, y: 18, width: 60, height: 22 },
          actions: ["click"],
        }],
      },
    },
  });

  assert.equal(scene.observationVersion, 11);
  assert.equal(scene.screenshotId, "screenshot-11");
  assert.deepEqual(
    [...new Set(scene.elements.map((element) => element.type))].sort(),
    ["ActionableItem", "Container", "Editable", "Window"],
  );
  assert.equal(scene.elements.every((element) => element.observationVersion === 11), true);
  assert.equal(scene.elements.every((element) => element.coordinate.screenshotId === "screenshot-11"), true);
  assert.equal(scene.elements.every((element) => element.coordinate.windowId === "window-1"), true);
  assert.equal(scene.elements.every((element) => element.coordinate.space === "window-local"), true);
  assert.equal(scene.elements.every((element) => (
    element.coordinate.cropOffset.x === 0 && element.coordinate.cropOffset.y === 0
  )), true);
  assert.equal(scene.elements.every((element) => element.parentId !== undefined), true);
  assert.equal(scene.elements.every((element) => Array.isArray(element.invalidatesOn)), true);

  const editable = resolveHostSceneElement(scene, { elementToken: "search" });
  assert.equal(editable.type, "Editable");
  assert.equal(editable.evidenceConsistency, "consistent");
  assert.deepEqual(editable.actions, ["set_value", "click", "type_text"]);

  const ocr = resolveHostSceneElement(scene, { elementToken: "ocr-query" });
  assert.equal(ocr.evidenceConsistency, "insufficient");
  assert.deepEqual(ocr.actions, []);
  assert.equal(ocr.actionable, false);
});

test("provider-declared evidence conflicts cannot produce a Host action", () => {
  const scene = buildHostScene({
    observationVersion: 12,
    observation: {
      observationId: "observation-12",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 1200, height: 800 },
      surfaceReceipt: { generation: 12, screenshotId: "shot-12", windowId: "window-1" },
      window: { id: "window-1", bounds: { width: 1200, height: 800 } },
      elements: [{
        elementToken: "conflicted",
        role: "list-item",
        source: "uia-som",
        bounds: { x: 10, y: 60, width: 280, height: 40 },
        actions: ["click"],
        evidenceConsistency: "conflict",
        conflicts: ["parent"],
      }],
    },
  });

  const target = resolveHostSceneElement(scene, { elementToken: "conflicted" });
  assert.equal(target.evidenceConsistency, "conflict");
  assert.deepEqual(target.actions, []);
  assert.equal(target.actionable, false);
});

test("screen-reported semantic bounds are projected into the declared window-local Scene space", () => {
  const scene = buildHostScene({
    observationVersion: 13,
    observation: {
      observationId: "observation-13",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 706, height: 413 },
      window: {
        id: "window-13",
        bounds: { x: 607, y: 306, width: 706, height: 413 },
      },
      elements: [{
        elementToken: "provider-edit",
        role: "edit",
        name: "Name",
        source: "uia-som",
        bounds: { x: 640, y: 449, width: 500, height: 23 },
        actions: ["set_value"],
      }],
    },
  });

  const editable = resolveHostSceneElement(scene, { elementToken: "provider-edit" });
  assert.deepEqual(editable.coordinate.bounds, { x: 33, y: 143, width: 500, height: 23 });
  assert.deepEqual(editable.evidence[0].bounds, { x: 33, y: 143, width: 500, height: 23 });
});

test("Host Scene preserves structural ownership, semantic identity, and observable control state", () => {
  const scene = buildHostScene({
    observationVersion: 14,
    observation: {
      observationId: "observation-14",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 800, height: 600 },
      window: {
        id: "window-14",
        title: "Fixture",
        role: "main-window",
        isForeground: true,
        bounds: { width: 800, height: 600 },
      },
      elements: [{
        elementToken: "conversation",
        role: "conversation",
        source: "uia-som",
        bounds: { x: 200, y: 0, width: 600, height: 600 },
        actions: [],
      }, {
        elementToken: "editor",
        parentElementToken: "conversation",
        role: "editable",
        source: "uia-som",
        bounds: { x: 240, y: 500, width: 500, height: 60 },
        actions: ["click", "type_text"],
        state: { focused: true },
        semanticKey: "editor:primary",
      }],
    },
  });

  const window = scene.elements.find((element) => element.type === "Window");
  const conversation = resolveHostSceneElement(scene, { elementToken: "conversation" });
  const editor = resolveHostSceneElement(scene, { elementToken: "editor" });
  assert.equal(window.role, "main-window");
  assert.equal(window.state.foreground, true);
  assert.deepEqual(window.actions, ["activate_window"]);
  assert.equal(editor.parentId, conversation.id);
  assert.deepEqual(editor.state, { focused: true });
  assert.equal(editor.semanticKey, "editor:primary");
});

test("Host Scene merges an owned window with its own screenshot and controller transform", () => {
  const scene = buildHostScene({
    observationVersion: 12,
    observation: {
      observationId: "multi-window-observation",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 954, height: 724 },
      surfaceReceipt: { screenshotId: "screenshot-0", windowId: "42", generation: 12 },
      window: { id: "42", title: "Main", bounds: { x: 452, y: 100, width: 954, height: 724 } },
      elements: [{
        hostType: "Window",
        role: "owned-auxiliary-window",
        elementToken: "owned-window:77",
        parentSceneRoot: true,
        bounds: { x: 0, y: 0, width: 368, height: 352 },
        source: "semantic",
        actions: [],
        coordinate: {
          screenshotId: "screenshot-1",
          windowId: "77",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          actionWindowId: "42",
          actionTransform: { scaleX: 1, scaleY: 1, offsetX: 49, offsetY: 63 },
        },
      }, {
        hostType: "TransientSurface",
        role: "search-results",
        elementToken: "search-results:77",
        parentElementToken: "owned-window:77",
        bounds: { x: 0, y: 0, width: 368, height: 352 },
        source: "semantic",
        actions: [],
        coordinate: {
          screenshotId: "screenshot-1",
          windowId: "77",
          space: "window-local",
          cropOffset: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          actionWindowId: "42",
          actionTransform: { scaleX: 1, scaleY: 1, offsetX: 49, offsetY: 63 },
        },
      }],
    },
  });

  const main = scene.elements.find((element) => element.type === "Window" && element.role === "main-window");
  const owned = resolveHostSceneElement(scene, { elementToken: "owned-window:77" });
  const transient = resolveHostSceneElement(scene, { elementToken: "search-results:77" });
  assert.equal(owned.type, "Window");
  assert.equal(owned.parentId, main.id);
  assert.equal(transient.type, "TransientSurface");
  assert.equal(transient.parentId, owned.id);
  assert.deepEqual(transient.coordinate, {
    screenshotId: "screenshot-1",
    windowId: "77",
    space: "window-local",
    cropOffset: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    bounds: { x: 0, y: 0, width: 368, height: 352 },
    actionWindowId: "42",
    actionTransform: { scaleX: 1, scaleY: 1, offsetX: 49, offsetY: 63 },
  });
});

test("consistent local fusion projects a search container and Editable without granting OCR authority", () => {
  const shared = {
    bounds: { x: 20, y: 20, width: 240, height: 40 },
    sourceRegion: { x: 20, y: 20, width: 240, height: 40 },
    confidence: 0.999,
    source: "local-proposal-fusion",
    modelIdentity: { provider: "local-proposal-fusion", model: "som-ocr-role-v1" },
    support: [
      { provider: "som-proposal", confidence: 0.94, proposalId: "visual-search" },
      { provider: "ocr", confidence: 0.99, proposalId: "ocr-search" },
    ],
    pixelLimitedAction: true,
    guessedAction: false,
  };
  const scene = buildHostScene({
    observationVersion: 15,
    observation: {
      observationId: "observation-15",
      coordinateSpace: "window-local",
      coordinateBounds: { x: 0, y: 0, width: 800, height: 600 },
      window: { id: "window-15", bounds: { width: 800, height: 600 } },
      localObservation: {
        elements: [{
          ...shared,
          elementToken: "search-parent",
          role: "search-container",
          actions: [],
        }, {
          ...shared,
          elementToken: "search",
          parentElementToken: "search-parent",
          role: "search",
          actions: ["click", "type_text"],
          value: "",
          state: { focused: false },
        }, {
          elementToken: "ocr-search",
          role: "text",
          name: "搜索",
          source: "ocr",
          bounds: { x: 40, y: 28, width: 42, height: 23 },
          actions: ["click"],
        }],
      },
    },
  });

  const parent = resolveHostSceneElement(scene, { elementToken: "search-parent" });
  const search = resolveHostSceneElement(scene, { elementToken: "search" });
  const ocr = resolveHostSceneElement(scene, { elementToken: "ocr-search" });
  assert.equal(parent.type, "Container");
  assert.equal(search.type, "Editable");
  assert.equal(search.parentId, parent.id);
  assert.deepEqual(search.actions, ["click", "type_text"]);
  assert.equal(ocr.evidenceConsistency, "insufficient");
  assert.deepEqual(ocr.actions, []);
});
