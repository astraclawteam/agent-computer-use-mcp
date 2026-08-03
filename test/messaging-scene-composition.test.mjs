import assert from "node:assert/strict";
import test from "node:test";

import {
  composeMessagingSceneElements,
  deduplicateVisualProposals,
  detectSemanticControlSurfaceFromPixels,
  inferConversationVisualStructure,
  inferSearchVisualStructure,
  stableCompositionOcrElements,
} from "../src/messaging-scene-composition.mjs";
import { detectControlSurfaceFromPixels } from "../src/control-surface-detection.mjs";
import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";
import { buildHostScene } from "../src/scene-region-ownership.mjs";

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

test("current OCR supersedes stale text at the same owned region", () => {
  const currentValue = {
    ...searchOcr,
    elementToken: "ocr-current-value",
    name: "Example-用户",
    value: "Example-用户",
    bounds: { x: 90, y: 44, width: 64, height: 23 },
  };

  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [currentValue],
    previousElements: [searchOcr],
    visualSceneStable: true,
  }), [currentValue]);
});

test("a stable high-confidence full label outranks a fresh strict OCR fragment", () => {
  const fullTitle = {
    ...searchOcr,
    elementToken: "ocr-full-title",
    name: "Y-大风",
    value: "Y-大风",
    bounds: { x: 317, y: 43, width: 57, height: 23 },
    confidence: 0.998,
  };
  const fragment = {
    ...fullTitle,
    elementToken: "ocr-title-fragment",
    name: "Y",
    value: "Y",
    bounds: { x: 317, y: 43, width: 14, height: 23 },
    confidence: 0.995,
  };

  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [fragment],
    previousElements: [fullTitle],
    visualSceneStable: true,
  }), [fullTitle]);
  assert.deepEqual(stableCompositionOcrElements({
    currentElements: [fullTitle],
    previousElements: [fragment],
    visualSceneStable: true,
  }), [fullTitle]);
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

test("pixel evidence recovers a semantic control when upscaled OCR expands to its border", () => {
  const image = solidImage(180, 90, 230);
  const surface = { x: 80, y: 40, width: 50, height: 24 };
  fillRect(image, surface, 250);
  fillRect(image, { x: 88, y: 43, width: 34, height: 18 }, 20);
  const expandedOcr = {
    source: "ocr",
    role: "text",
    name: "发送",
    value: "发送",
    bounds: { x: 84, y: 40, width: 42, height: 24 },
  };

  assert.deepEqual(detectSemanticControlSurfaceFromPixels(image, expandedOcr), surface);
});

test("an exact semantic OCR-to-pixel association owns a control when both boxes share a border", () => {
  const sendOcr = {
    elementToken: "ocr-send-border",
    role: "text",
    name: "发送",
    value: "发送",
    bounds: { x: 879, y: 676, width: 40, height: 24 },
    confidence: 0.99,
    source: "ocr",
    proposalId: "ocr-send-border",
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [sendOcr],
    visualProposals: [
      structuralProposal("conversation-pane", { x: 300, y: 30, width: 660, height: 690 }),
      structuralProposal("conversation-header", { x: 300, y: 30, width: 660, height: 50 }),
      structuralProposal("conversation-transcript", { x: 300, y: 80, width: 660, height: 500 }),
      structuralProposal("message-editor", { x: 300, y: 580, width: 660, height: 140 }),
      {
        proposalId: "semantic-surface-border",
        semanticOcrKey: "发送:879:676:40:24",
        role: "region",
        bounds: { x: 875, y: 676, width: 48, height: 24 },
        confidence: 0.94,
        source: "som-proposal",
      },
    ],
  });

  const send = result.elements.find((element) => element.role === "send");
  assert.ok(send);
  assert.deepEqual(send.bounds, { x: 875, y: 676, width: 48, height: 24 });
  assert.deepEqual(send.actions, ["click"]);
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
});

test("one unique top-toolbar surface and its SOM child create a search editable when placeholder OCR is absent", () => {
  const image = solidImage(960, 720, 230);
  const surface = { x: 76, y: 42, width: 176, height: 28 };
  const label = {
    proposalId: "som-placeholder-shape",
    role: "region",
    bounds: { x: 101, y: 50, width: 24, height: 12 },
    confidence: 0.82,
    source: "som-proposal",
  };
  fillRect(image, surface, 255);
  fillRect(image, label.bounds, 40);

  const structures = inferSearchVisualStructure({ pixels: image, proposals: [label] });
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [],
    visualProposals: [label, ...structures],
  });
  const search = result.elements.find((element) => element.role === "search");

  assert.equal(structures.length, 1);
  assert.deepEqual(structures[0].bounds, surface);
  assert.equal(search.value, "");
  assert.deepEqual(search.actions, ["click", "type_text"]);
  assert.deepEqual(search.support.map(({ provider }) => provider).sort(), [
    "som-proposal",
    "visual-structure",
  ]);
});

test("multiple structural search surfaces remain non-actionable without an owner tie-break", () => {
  const visualProposals = [
    {
      proposalId: "visual-search-surface:first",
      role: "search-surface",
      bounds: { x: 76, y: 42, width: 176, height: 28 },
      confidence: 0.97,
      source: "visual-structure",
      supportProposalId: "som-first",
    },
    {
      proposalId: "visual-search-surface:second",
      role: "search-surface",
      bounds: { x: 76, y: 82, width: 176, height: 28 },
      confidence: 0.97,
      source: "visual-structure",
      supportProposalId: "som-second",
    },
    { proposalId: "som-first", source: "som-proposal", bounds: { x: 101, y: 50, width: 24, height: 12 } },
    { proposalId: "som-second", source: "som-proposal", bounds: { x: 101, y: 90, width: 24, height: 12 } },
  ];

  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [],
    visualProposals,
  });

  assert.equal(result.elements.some((element) => element.actions.length > 0), false);
  assert.deepEqual(result.knownControls, []);
});

test("owned layout separators plus header OCR and editor SOM compose one conversation Scene", () => {
  const image = solidImage(960, 720, 230);
  fillRect(image, { x: 301, y: 0, width: 659, height: 720 }, 250);
  fillRect(image, { x: 301, y: 32, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 80, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 580, width: 659, height: 1 }, 170);
  const editorSom = {
    proposalId: "som-editor-toolbar",
    role: "region",
    bounds: { x: 330, y: 675, width: 20, height: 20 },
    confidence: 0.86,
    source: "som-proposal",
  };
  const bubbleSom = {
    proposalId: "som-self-bubble",
    role: "region",
    bounds: { x: 700, y: 120, width: 180, height: 44 },
    confidence: 0.9,
    source: "som-proposal",
  };
  const sendSom = {
    proposalId: "semantic-surface-send",
    role: "region",
    bounds: { x: 850, y: 650, width: 80, height: 36 },
    confidence: 0.92,
    source: "som-proposal",
  };
  const titleOcr = {
    elementToken: "ocr-conversation-title",
    role: "text",
    name: "联系人甲",
    value: "联系人甲",
    bounds: { x: 320, y: 45, width: 70, height: 20 },
    confidence: 0.99,
    source: "ocr",
    proposalId: "ocr-conversation-title",
  };
  const bubbleOcr = {
    elementToken: "ocr-self-bubble",
    role: "text",
    name: "测试消息",
    value: "测试消息",
    bounds: { x: 720, y: 132, width: 100, height: 20 },
    confidence: 0.99,
    source: "ocr",
  };
  const sendOcr = {
    elementToken: "ocr-send",
    role: "text",
    name: "发送",
    value: "发送",
    bounds: { x: 870, y: 658, width: 40, height: 20 },
    confidence: 0.99,
    source: "ocr",
  };
  const draftOcr = {
    elementToken: "ocr-message-draft",
    role: "text",
    name: "这是一条测试消息",
    value: "这是一条测试消息",
    bounds: { x: 320, y: 600, width: 128, height: 20 },
    confidence: 0.99,
    source: "ocr",
    proposalId: "ocr-message-draft",
  };
  const editorBorderNoise = {
    elementToken: "ocr-editor-border-noise",
    role: "text",
    name: "7",
    value: "7",
    bounds: { x: 923, y: 581, width: 20, height: 13 },
    confidence: 0.2,
    source: "ocr",
    proposalId: "ocr-editor-border-noise",
  };
  const structures = inferConversationVisualStructure({ pixels: image });
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [titleOcr, bubbleOcr, sendOcr, draftOcr, editorBorderNoise],
    visualProposals: [editorSom, bubbleSom, sendSom, ...structures],
    changedRegion: { x: 700, y: 120, width: 150, height: 60 },
  });
  const conversation = result.elements.find((element) => element.role === "conversation");
  const header = result.elements.find((element) => element.role === "conversation-header");
  const transcript = result.elements.find((element) => element.role === "transcript");
  const title = result.elements.find((element) => element.role === "conversation-title");
  const editor = result.elements.find((element) => element.role === "message-editor");
  const send = result.elements.find((element) => element.role === "send");
  const bubble = result.elements.find((element) => element.role === "message-bubble");

  assert.deepEqual(structures.map(({ role }) => role), [
    "conversation-pane",
    "conversation-header",
    "conversation-transcript",
    "message-editor",
  ]);
  assert.equal(header.parentElementToken, conversation.elementToken);
  assert.equal(transcript.parentElementToken, conversation.elementToken);
  assert.equal(title.parentElementToken, header.elementToken);
  assert.equal(title.name, "联系人甲");
  assert.equal(title.semanticKey, "conversation:联系人甲");
  assert.equal(editor.parentElementToken, conversation.elementToken);
  assert.equal(editor.value, "这是一条测试消息");
  assert.equal(editor.state.valueObserved, true);
  assert.deepEqual(editor.actions, ["click", "type_text"]);
  assert.deepEqual(editor.support.map(({ provider }) => provider).sort(), [
    "ocr",
    "som-proposal",
    "visual-structure",
  ]);
  assert.deepEqual(conversation.support.map(({ provider }) => provider).sort(), ["ocr", "visual-structure"]);
  assert.deepEqual(header.support.map(({ provider }) => provider).sort(), ["ocr", "visual-structure"]);
  assert.deepEqual(transcript.support.map(({ provider }) => provider).sort(), ["som-proposal", "visual-structure"]);
  const scene = buildHostScene({
    observationVersion: 1,
    observation: {
      observationId: "conversation-composition",
      coordinateSpace: "window-local",
      coordinateBounds: bounds,
      surfaceReceipt: {
        generation: 1,
        screenshotId: "conversation-composition-shot",
        windowId: "conversation-composition-window",
      },
      window: {
        id: "conversation-composition-window",
        title: "Fixture",
        bounds,
      },
      elements: result.elements,
    },
  });
  for (const element of [conversation, header, transcript]) {
    const hostElement = scene.elements.find(
      (candidate) => candidate.binding?.elementToken === element.elementToken,
    );
    assert.equal(hostElement.evidenceConsistency, "consistent");
  }
  assert.equal(send.parentElementToken, conversation.elementToken);
  assert.deepEqual(send.actions, ["click"]);
  assert.equal(bubble.parentElementToken, transcript.elementToken);
  assert.equal(bubble.state.authoredBySelf, true);
  assert.equal(bubble.state.latestInTranscript, true);
  assert.equal(bubble.state.changedSincePreviousFrame, true);
  assert.equal(transcript.state.changedSincePreviousFrame, true);
});

test("a broad SOM region cannot masquerade as the role-owned send control", () => {
  const image = solidImage(960, 720, 230);
  fillRect(image, { x: 301, y: 0, width: 659, height: 720 }, 250);
  fillRect(image, { x: 301, y: 32, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 80, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 580, width: 659, height: 1 }, 170);
  const structures = inferConversationVisualStructure({ pixels: image });
  const editor = structures.find((proposal) => proposal.role === "message-editor");
  const editorSom = {
    proposalId: "som-editor",
    role: "region",
    bounds: editor.bounds,
    confidence: 0.95,
    source: "som-proposal",
  };
  const sendOcr = {
    elementToken: "ocr-send",
    role: "text",
    name: "发送",
    value: "发送",
    bounds: { x: 870, y: 658, width: 40, height: 20 },
    confidence: 0.99,
    source: "ocr",
  };
  const broadSom = {
    proposalId: "som-broad-editor-region",
    role: "region",
    bounds: { x: 650, y: 620, width: 280, height: 90 },
    confidence: 0.95,
    source: "som-proposal",
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [sendOcr],
    visualProposals: [editorSom, broadSom, ...structures],
  });

  assert.equal(result.elements.some((element) => element.role === "send"), false);
});

test("a pane-wide editor separator outranks a darker short text stroke", () => {
  const image = solidImage(960, 720, 230);
  fillRect(image, { x: 301, y: 0, width: 659, height: 720 }, 250);
  fillRect(image, { x: 301, y: 32, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 80, width: 659, height: 1 }, 170);
  fillRect(image, { x: 301, y: 580, width: 659, height: 1 }, 246);
  fillRect(image, { x: 315, y: 599, width: 127, height: 1 }, 100);

  const structures = inferConversationVisualStructure({ pixels: image });
  const editor = structures.find((proposal) => proposal.role === "message-editor");

  assert.equal(editor.bounds.y, 581);
  assert.equal(editor.bounds.height, 139);
});

test("a remembered search control cannot fabricate OCR support", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  assert.deepEqual(result.elements, []);
  assert.deepEqual(result.knownControls, []);
});

test("a remembered search value excludes OCR outside its content band", () => {
  const query = {
    ...searchOcr,
    elementToken: "ocr-query",
    proposalId: "ocr-query",
    name: "Example-用户",
    value: "Example-用户",
    bounds: { x: 102, y: 45, width: 78, height: 20 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [
      { ...searchOcr, elementToken: "ocr-icon-left", proposalId: "ocr-icon-left", name: "Q", value: "Q", bounds: { x: 78, y: 45, width: 10, height: 20 } },
      query,
      { ...searchOcr, elementToken: "ocr-icon-right", proposalId: "ocr-icon-right", name: "M", value: "M", bounds: { x: 238, y: 45, width: 10, height: 20 } },
    ],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "Example-用户");
  assert.equal(search.support.find((entry) => entry.provider === "ocr").proposalId, "ocr-query");
});

test("a remembered search control separates a merged leading OCR icon from its value", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      elementToken: "ocr-merged-query",
      proposalId: "ocr-merged-query",
      name: "QExample-用户",
      value: "QExample-用户",
      bounds: { x: 71, y: 43, width: 110, height: 24 },
    }],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "Example-用户");
});

test("a remembered search control accepts decorated OCR whose icon extends beyond a compact visual owner", () => {
  const compactOwner = {
    ...searchSurface,
    bounds: { x: 88, y: 43, width: 146, height: 24 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      elementToken: "ocr-compact-owner-query",
      proposalId: "ocr-compact-owner-query",
      name: "Q Example-用户",
      value: "Q Example-用户",
      bounds: { x: 66.5, y: 40.5, width: 112, height: 29 },
    }],
    visualProposals: [compactOwner],
    knownControls: [{
      role: "search",
      bounds: compactOwner.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "Example-用户");
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("a remembered search control prefers the complete semantic surface over a smaller clear-button owner", () => {
  const remembered = { x: 77, y: 42, width: 170, height: 26 };
  const complete = {
    ...searchSurface,
    proposalId: "semantic-surface-complete-search",
    bounds: { x: 78, y: 40, width: 168, height: 29 },
  };
  const clearButtonOwner = {
    ...searchSurface,
    proposalId: "som-clear-button-owner",
    bounds: { x: 139, y: 43, width: 111, height: 24 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      elementToken: "ocr-complete-query",
      proposalId: "ocr-complete-query",
      name: "Q Example-用户",
      value: "Q Example-用户",
      bounds: { x: 66.5, y: 41, width: 98, height: 27.5 },
    }, {
      ...searchOcr,
      elementToken: "ocr-clear-button",
      proposalId: "ocr-clear-button",
      name: "回",
      value: "回",
      bounds: { x: 222.5, y: 43.5, width: 30, height: 23 },
    }],
    visualProposals: [clearButtonOwner, complete],
    knownControls: [{ role: "search", bounds: remembered, semanticKey: "control:search" }],
  });

  const searches = result.elements.filter((element) => element.role === "search");
  assert.equal(searches.length, 1);
  assert.equal(searches[0].value, "Example-用户");
  assert.deepEqual(searches[0].bounds, complete.bounds);
});

test("a merged leading OCR icon does not turn a search placeholder into its value", () => {
  const mergedPlaceholder = {
    ...searchOcr,
    elementToken: "ocr-merged-placeholder",
    proposalId: "ocr-merged-placeholder",
    name: "Q搜索",
    value: "Q搜索",
    bounds: { x: 71, y: 43, width: 61, height: 24 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [mergedPlaceholder],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "");
  assert.equal(search.support.find((entry) => entry.provider === "ocr").proposalId, "ocr-merged-placeholder");
});

test("a separated OCR icon and punctuation do not become the search value", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      elementToken: "ocr-separated-placeholder",
      proposalId: "ocr-separated-placeholder",
      name: `Q. ${searchOcr.name}`,
      value: `Q. ${searchOcr.value}`,
      bounds: { x: 72.5, y: 45, width: 58, height: 20.5 },
    }],
    visualProposals: [{
      ...searchSurface,
      proposalId: "semantic-surface-separated-placeholder",
      bounds: { x: 77, y: 42, width: 170, height: 26 },
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.ok(search);
  assert.equal(search.value, "");
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("a punctuation-shaped OCR search icon leaves the placeholder value empty", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      name: ". 搜索",
      value: ". 搜索",
      bounds: { x: 82, y: 45, width: 52, height: 20 },
    }],
    visualProposals: [searchSurface],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.ok(search);
  assert.equal(search.value, "");
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("a fresh connector can recover a populated search role from icon and surface evidence", () => {
  const decoratedQuery = {
    ...searchOcr,
    elementToken: "ocr-decorated-query",
    proposalId: "ocr-decorated-query",
    name: "QExample-用户",
    value: "QExample-用户",
    bounds: { x: 71, y: 43, width: 110, height: 24 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [decoratedQuery],
    visualProposals: [searchSurface],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, "Example-用户");
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("ordinary words starting with Q are not interpreted as a search icon", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{ ...searchOcr, name: "Question", value: "Question" }],
    visualProposals: [searchSurface],
  });

  assert.deepEqual(result.elements, []);
});

test("conflicting OCR values for the same search occurrence suppress actions and value", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [
      { ...searchOcr, elementToken: "ocr-value-a", proposalId: "ocr-value-a", name: "Example-A", value: "Example-A", bounds: { x: 95, y: 44, width: 75, height: 22 } },
      { ...searchOcr, elementToken: "ocr-value-b", proposalId: "ocr-value-b", name: "Example-B", value: "Example-B", bounds: { x: 96, y: 44, width: 75, height: 22 } },
    ],
    visualProposals: [searchSurface],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.equal(search.value, null);
  assert.equal(search.evidenceConsistency, "conflict");
  assert.deepEqual(search.actions, []);
  assert.deepEqual(result.knownControls, []);
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

test("a verified search value remains authoritative only while fresh owned OCR agrees", () => {
  const verifiedControl = {
    role: "search",
    bounds: searchSurface.bounds,
    semanticKey: "control:search",
    verifiedValue: "Exact query",
    verifiedAtObservationId: "verified-observation",
  };
  const exact = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      name: "Exact query",
      value: "Exact query",
      bounds: { x: 95, y: 44, width: 82, height: 22 },
    }],
    visualProposals: [searchSurface],
    knownControls: [verifiedControl],
  });
  const conflicting = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      name: "Other query",
      value: "Other query",
      bounds: { x: 95, y: 44, width: 82, height: 22 },
    }],
    visualProposals: [searchSurface],
    knownControls: [verifiedControl],
  });

  assert.equal(exact.elements.find((element) => element.role === "search").value, "Exact query");
  assert.equal(exact.knownControls[0].verifiedValue, "Exact query");
  const conflictedSearch = conflicting.elements.find((element) => element.role === "search");
  assert.deepEqual(conflictedSearch.actions, []);
  assert.deepEqual(conflictedSearch.conflicts, ["value"]);
  assert.deepEqual(conflicting.knownControls, []);
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

test("fresh semantic geometry replaces a wider remembered control boundary", () => {
  const semantic = {
    ...searchSurface,
    proposalId: "semantic-surface-current",
    bounds: { x: 72, y: 41, width: 180, height: 28 },
  };
  const rememberedOuter = { x: 48, y: 38, width: 252, height: 32 };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{ ...searchOcr, name: "林舟", value: "林舟" }],
    visualProposals: [
      semantic,
      { ...searchSurface, proposalId: "som-remembered-outer", bounds: rememberedOuter },
    ],
    knownControls: [{
      role: "search",
      bounds: rememberedOuter,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.deepEqual(search.bounds, semantic.bounds);
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("a tiny contained proposal cannot replace remembered editable geometry", () => {
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{ ...searchOcr, name: "林舟", value: "林舟" }],
    visualProposals: [
      searchSurface,
      {
        ...searchSurface,
        proposalId: "tiny-contained-icon",
        bounds: { x: 86, y: 42, width: 50, height: 26 },
      },
    ],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.deepEqual(search.bounds, searchSurface.bounds);
});

test("a complete pixel semantic surface wins over a same-source SOM outer frame", () => {
  const semantic = {
    ...searchSurface,
    proposalId: "semantic-surface-1",
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{ ...searchOcr, name: "Example-用户", value: "Example-用户" }],
    visualProposals: [
      semantic,
      { ...searchSurface, proposalId: "som-outer", bounds: { x: 73, y: 36, width: 187, height: 40 } },
    ],
    knownControls: [{
      role: "search",
      bounds: searchSurface.bounds,
      semanticKey: "control:search",
    }],
  });

  const search = result.elements.find((element) => element.role === "search");
  assert.deepEqual(search.bounds, semantic.bounds);
  assert.equal(search.evidenceConsistency, undefined);
  assert.deepEqual(search.actions, ["click", "type_text"]);
});

test("matching OCR below search does not invent a result container or actionable row", () => {
  const repeatedText = {
    ...searchOcr,
    elementToken: "ocr-repeated-text",
    proposalId: "ocr-repeated-text",
    name: "Example-用户",
    value: "Example-用户",
    bounds: { x: 126, y: 112, width: 78, height: 20 },
  };
  const resultSurface = {
    ...searchSurface,
    proposalId: "visual-unowned-row",
    bounds: { x: 74, y: 96, width: 316, height: 58 },
  };
  const result = composeMessagingSceneElements({
    coordinateBounds: bounds,
    ocrElements: [{
      ...searchOcr,
      name: "QExample-用户",
      value: "QExample-用户",
      bounds: { x: 82, y: 45, width: 98, height: 20 },
    }, repeatedText],
    visualProposals: [searchSurface, resultSurface],
  });

  assert.equal(result.elements.some((element) => element.role === "search-results"), false);
  assert.equal(result.elements.some((element) => element.role === "search-result"), false);
});

test("a full-window OCR baseline composes the fused search control without an LLM visual question", async (t) => {
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
    }, {}, ticket)
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

test("the production screenshot path retries composition with one editor-owned OCR crop when send is absent", async (t) => {
  const editorBounds = { x: 301, y: 581, width: 658, height: 138 };
  const sendBounds = { x: 877, y: 677, width: 45, height: 23 };
  const sendOcr = {
    elementToken: "ocr-send-targeted",
    role: "text",
    name: "发送",
    value: "发送",
    bounds: { x: 884, y: 679, width: 28, height: 16 },
    confidence: 0.99,
    source: "ocr",
    proposalId: "ocr-send-targeted",
  };
  const editor = {
    hostType: "Editable",
    elementToken: "message-editor:targeted-fixture",
    role: "message-editor",
    name: "Message editor",
    value: "这是一条测试消息",
    bounds: editorBounds,
    sourceRegion: editorBounds,
    source: "local-proposal-fusion",
    modelIdentity: { provider: "local-proposal-fusion", model: "fixture" },
    confidence: 0.98,
    actions: ["click", "type_text"],
    support: [
      { provider: "visual-structure", confidence: 0.98, proposalId: "structure-editor" },
      { provider: "som-proposal", confidence: 0.95, proposalId: "som-editor" },
    ],
    pixelLimitedAction: true,
    guessedAction: false,
  };
  const send = {
    hostType: "ActionableItem",
    elementToken: "send:targeted-fixture",
    role: "send",
    name: "发送",
    value: "发送",
    bounds: sendBounds,
    sourceRegion: editorBounds,
    source: "local-proposal-fusion",
    modelIdentity: { provider: "local-proposal-fusion", model: "fixture" },
    confidence: 0.98,
    actions: ["click"],
    support: [
      { provider: "ocr", confidence: 0.99, proposalId: "ocr-send-targeted" },
      { provider: "som-proposal", confidence: 0.94, proposalId: "semantic-surface-send" },
    ],
    pixelLimitedAction: true,
    guessedAction: false,
  };
  let compositionCalls = 0;
  let visualProposalCalls = 0;
  let semanticSurfaceCalls = 0;
  const ocrCrops = [];
  const router = new ComputerUseProviderRouter({
    messagingVisualProposalOperation: async ({ ocrElements }) => {
      visualProposalCalls += 1;
      return [];
    },
    messagingSemanticSurfaceOperation: async ({ ocrElements }) => {
      semanticSurfaceCalls += 1;
      return ocrElements.some((element) => element.name === "发送")
        ? [{ proposalId: "semantic-surface-send", bounds: sendBounds }]
        : [];
    },
    messagingSceneComposition: ({ ocrElements }) => {
      compositionCalls += 1;
      return {
        elements: ocrElements.some((element) => element.name === "发送")
          ? [editor, send]
          : [editor],
        knownControls: [],
      };
    },
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "window-1", windowId: "window-1", title: "Fixture", bounds },
    expiresAtMs: Date.now() + 60_000,
  };
  router.readOwnedArtifact = async () => Buffer.from("fixture-pixels");
  router.ocrRegionOperation = async ({ crop }) => {
    ocrCrops.push(crop ?? null);
    return {
      observation: {
        source: "ocr",
        elements: crop ? [sendOcr] : [],
      },
    };
  };

  const observation = await router.runOperation((ticket) => (
    router.prioritizeLocalScreenshotPerception({
      observationId: "shot-targeted-send",
      artifact: { path: "C:\\owned\\shot.png" },
      capture: { width: bounds.width, height: bounds.height },
      coordinateSpace: "window-local",
      coordinateBounds: bounds,
      window: { id: "window-1", bounds },
      includeUserOverlay: false,
    }, { messagingSceneIntent: "send" }, ticket)
  ));

  assert.deepEqual(ocrCrops, [null, editorBounds]);
  assert.equal(visualProposalCalls, 1);
  assert.equal(semanticSurfaceCalls, 1);
  assert.equal(compositionCalls, 2);
  assert.equal(observation.localObservation.elements.filter((element) => element.role === "send").length, 1);
  assert.equal(observation.localObservation.elements.some((element) => element === sendOcr), true);
});

test("the production screenshot path merges a proven related search surface into one Host Scene", async (t) => {
  const relatedPath = "C:\\owned\\shot.related-1.png";
  const router = new ComputerUseProviderRouter({
    ocrSession: {
      async start() {},
      async close() {},
      async recognize({ imagePath }) {
        assert.equal(imagePath, relatedPath);
        return {
          status: "ok",
          items: [{
            text: "联系人甲",
            confidence: 0.99,
            bounds: { x: 58, y: 63, width: 72, height: 22 },
          }],
        };
      },
    },
    messagingVisualProposalOperation: async ({ imagePath }) => (
      imagePath === relatedPath
        ? [{
            proposalId: "direct-contact-row",
            confidence: 0.94,
            bounds: { x: 48, y: 52, width: 112, height: 44 },
          }]
        : [searchSurface]
    ),
  });
  t.after(() => router.close());
  router.activeController = {
    controllerId: "controller-1",
    tier: "full",
    window: { id: "42", windowId: "42", title: "Fixture", bounds: { ...bounds, x: 452, y: 100 } },
    expiresAtMs: Date.now() + 60_000,
  };
  router.activeFocusReceipt = {
    target: { bounds: searchSurface.bounds },
  };
  router.readOwnedArtifact = async () => Buffer.from("fixture-pixels");
  router.ocrRegionOperation = async () => ({
    observation: { source: "ocr", elements: [searchOcr] },
  });

  const observation = await router.runOperation((ticket) => (
    router.prioritizeLocalScreenshotPerception({
      observationId: "shot-related",
      artifact: { path: "C:\\owned\\shot.png" },
      capture: {
        hwnd: "42",
        x: 452,
        y: 100,
        width: bounds.width,
        height: bounds.height,
        relatedSurfaces: [{
          status: "ok",
          hwnd: "77",
          ownerWindowId: "42",
          title: "",
          screenshotId: "screenshot-1",
          x: 501,
          y: 163,
          width: 368,
          height: 352,
          path: relatedPath,
          window: { id: "77", pid: 1234, bounds: { x: 501, y: 163, width: 368, height: 352 } },
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
        }],
      },
      coordinateSpace: "window-local",
      coordinateBounds: bounds,
      window: { id: "42", bounds: { ...bounds, x: 452, y: 100 } },
      includeUserOverlay: false,
    }, {}, ticket)
  ));
  const actionObservation = router.createActionObservation(observation);
  const main = actionObservation.scene.elements.find((element) => (
    element.type === "Window" && element.role === "main-window"
  ));
  const owned = actionObservation.scene.elements.find((element) => element.role === "owned-auxiliary-window");
  const surfaceElement = actionObservation.scene.elements.find((element) => element.role === "search-results");
  const result = actionObservation.scene.elements.find((element) => element.role === "search-result");

  assert.equal(owned.parentId, main.id);
  assert.equal(surfaceElement.parentId, owned.id);
  assert.equal(result.parentId, surfaceElement.id);
  assert.equal(result.name, "联系人甲");
  assert.deepEqual(result.actions, ["click"]);
  assert.equal(result.coordinate.screenshotId, "screenshot-1");
  assert.equal(result.coordinate.windowId, "77");
});

function structuralProposal(role, proposalBounds) {
  return {
    proposalId: `visual-${role}`,
    role,
    bounds: proposalBounds,
    confidence: 0.98,
    source: "visual-structure",
  };
}

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
