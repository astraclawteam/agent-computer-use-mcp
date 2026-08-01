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
      { claimId: "query", source: "ocr", regionId: "search", text: "宋鹏", bounds: { x: 30, y: 18, width: 60, height: 22 } },
      { claimId: "candidate", source: "ocr", regionId: "dropdown", text: "宋鹏", bounds: { x: 35, y: 75, width: 60, height: 22 } },
      { claimId: "history-text", source: "ocr", regionId: "history", text: "宋鹏", bounds: { x: 35, y: 280, width: 60, height: 22 } },
      { claimId: "chat-text", source: "ocr", regionId: "chat", text: "宋鹏", bounds: { x: 500, y: 300, width: 60, height: 22 } },
    ],
  });

  assert.equal(scene.regionValues.search, "宋鹏");
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
          name: "宋鹏",
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
  assert.equal(scene.elements.every((element) => element.parentId !== undefined), true);
  assert.equal(scene.elements.every((element) => Array.isArray(element.invalidatesOn)), true);

  const editable = resolveHostSceneElement(scene, { elementToken: "search" });
  assert.equal(editable.type, "Editable");
  assert.equal(editable.evidenceConsistency, "consistent");
  assert.deepEqual(editable.actions, ["set_value", "click"]);

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
