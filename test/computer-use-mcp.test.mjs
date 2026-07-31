import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Ajv from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCanvas } from "ppu-ocv";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";
import {
  callTool,
  compactComputerUseResult,
  createPlatformOcrSession,
  main,
  observeComputer,
  projectComputerUseMediaResult,
  renderComputerUseTextResult,
  runComputerUseMcpServer,
  shouldAutoStartComputerUseMcpServer,
} from "../src/computer-use-mcp-server.mjs";

test("source and SEA entrypoints share one MCP composition", () => {
  assert.equal(typeof main, "function");
  assert.equal(main, runComputerUseMcpServer);
});

test("model-facing MCP text uses compact Markdown while structuredContent stays lossless", async () => {
  const payload = {
    status: "idle",
    foregroundWindow: { windowId: 7, title: "Example", isForeground: true },
    windows: [
      { windowId: 7, title: "Example", isForeground: true },
      { windowId: 8, title: "Background", isForeground: false },
    ],
  };
  const result = await callTool({
    async listState() {
      return payload;
    },
  }, "computer.observe", { mode: "state" });

  assert.match(result.content[0].text, /^# Computer Use Result\n/u);
  assert.match(result.content[0].text, /## windows \(2\)/u);
  assert.equal(result.structuredContent.foregroundWindow.title, "Example");
  assert.ok(
    result.content[0].text.length < JSON.stringify(result.structuredContent, null, 2).length,
    "compact Markdown should be smaller than the former pretty-JSON projection",
  );
  assert.equal(renderComputerUseTextResult(null), "# Computer Use Result\n\n- **value**: null");
});

test("application projection keeps semantic state and opaque tokens while dropping process noise", () => {
  const projected = compactComputerUseResult({
    applications: [{
      applicationToken: "application-1",
      name: "Desktop App",
      state: "recoverable",
      running: true,
      active: false,
      visible: false,
      pid: 4242,
      kind: "desktop",
      lastUsed: "2026-07-31T00:00:00Z",
    }],
  });

  assert.deepEqual(projected.applications, [{
    applicationToken: "application-1",
    name: "Desktop App",
    state: "recoverable",
  }]);
  assert.equal(projected.applicationCount, 1);
  assert.equal(JSON.stringify(projected).includes("4242"), false);
  assert.equal(JSON.stringify(projected).includes("lastUsed"), false);
});

test("indeterminate desktop actions remain successful MCP calls that require observation", async () => {
  const result = await callTool({
    async act() {
      return {
        status: "indeterminate",
        outcome: "unverified",
        action: "type_text",
        result: {
          effect: "possibly_applied",
          verified: false,
          replaySafe: false,
        },
        pixelLimitedAction: true,
      };
    },
  }, "computer.act", {
    action: {
      kind: "type_text",
      observationId: "capture-1",
      x: 100,
      y: 50,
      value: "example",
    },
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "indeterminate");
  assert.equal(result.structuredContent.outcome, "unverified");
  assert.equal(result.structuredContent.result.replaySafe, false);
});

test("safe action contract rejections are non-fatal not-applied results", async () => {
  const result = await callTool({
    async act() {
      const error = new Error("A screenshot-grounded target rectangle is required.");
      error.code = "target.editable_interior_required";
      error.detail = {
        allowed: false,
        pixelLimitedAction: false,
        nextAction: "Capture a fresh screenshot and use atomic type_text.",
      };
      throw error;
    },
  }, "computer.act", {
    action: {
      kind: "click",
      interactionIntent: "activate-control",
      observationId: "ocr-1",
      coordinateSpace: "window-local",
      x: 75,
      y: 46,
    },
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "not-applied");
  assert.equal(result.structuredContent.outcome, "blocked");
  assert.equal(result.structuredContent.result.effect, "not-applied");
  assert.equal(result.structuredContent.result.replaySafe, true);
  assert.equal(result.structuredContent.error.code, "target.editable_interior_required");
});

test("a missing foreground window is a non-fatal acquire precondition", async () => {
  const result = await callTool({
    async requestAccess() {
      const error = new Error("No visible window matched the requested selector.");
      error.code = "window.not_found";
      error.detail = {
        retryable: true,
        nextTool: "computer.observe",
        suggestedAction: "Discover state and acquire the returned applicationToken.",
      };
      throw error;
    },
  }, "computer.acquire", {
    target: "foreground",
    tier: "full",
  });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "not-applied");
  assert.equal(result.structuredContent.outcome, "blocked");
  assert.equal(result.structuredContent.error.code, "window.not_found");
  assert.equal(result.structuredContent.result.replaySafe, true);
});

test("unified OCR observation preserves the active controller context", async () => {
  const calls = [];
  const result = await observeComputer({
    async capture(args) {
      calls.push(args);
      return { status: "ok", source: "ocr", elements: [] };
    },
    async ocrRegion() {
      throw new Error("legacy standalone OCR route must not be used");
    },
  }, {
    mode: "ocr-region",
    languages: ["zh", "en"],
  });

  assert.deepEqual(calls, [{ mode: "ocr-region", languages: ["zh", "en"] }]);
  assert.deepEqual(result, { status: "ok", source: "ocr", elements: [] });
});

test("screenshot remains OCR-first even when a caller supplies a visual question", async () => {
  const calls = [];
  await observeComputer({
    async capture(args) {
      calls.push(args);
      return { status: "ok" };
    },
  }, {
    mode: "screenshot",
    visualQuestion: "Is the icon selected?",
  });

  assert.deepEqual(calls, [{ mode: "screenshot" }]);
});

test("visual observation is an explicit escalation with one required question", async () => {
  const calls = [];
  await assert.rejects(
    observeComputer({ capture() {} }, { mode: "visual" }),
    /visual_question_required/u,
  );

  await observeComputer({
    async capture(args) {
      calls.push(args);
      return { status: "ok" };
    },
  }, {
    mode: "visual",
    visualQuestion: "  Which icon opens the overflow menu?  ",
  });

  assert.deepEqual(calls, [{
    mode: "screenshot",
    requestedMode: "visual",
    visualQuestion: "Which icon opens the overflow menu?",
  }]);
});

test("successful unified OCR observations satisfy the public result envelope", async () => {
  const result = await callTool({
    async capture() {
      return {
        status: "ok",
        source: "ocr",
        observationId: "ocr-1",
        modelPack: "pp-ocr-v6-small",
        modelFormat: "onnx",
        sessionMode: "persistent",
        runtime: "onnxruntime",
        executionProvider: "cpu",
        cacheHit: false,
        crop: null,
        timings: { totalMs: 125 },
        elements: [],
        focusReceipt: {
          id: "focus-post-write-1",
          status: "verified",
        },
        mutationVerification: {
          status: "confirmed",
          actionKind: "type_text",
          method: "exact-observed-value-near-grounded-target",
          replaySafe: false,
          focusReceiptIssued: true,
        },
        includeUserOverlay: false,
      };
    },
  }, "computer.observe", { mode: "ocr-region" });

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.resultSchemaVersion, "5.5");
  assert.equal(result.structuredContent.includeUserOverlay, false);
  const observe = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.observe");
  const validate = new Ajv({ strict: false }).compile(observe.outputSchema);
  assert.equal(validate(result.structuredContent), true, JSON.stringify(validate.errors));
  assert.equal(result.structuredContent.focusReceipt.id, "focus-post-write-1");
  assert.equal(result.structuredContent.mutationVerification.status, "confirmed");
});

test("semantic-first screenshot observations satisfy the strict public result envelope", async () => {
  const result = await callTool({
    async capture() {
      return {
        status: "ok",
        mode: "semantic",
        requestedMode: "screenshot",
        perceptionRouting: {
          selectedMode: "semantic",
          avoidedVision: true,
          sufficient: true,
          actionableElementCount: 24,
          namedActionableRatio: 1,
        },
        source: "cua-driver",
        observationId: "semantic-short-circuit",
        elements: [],
        includeUserOverlay: false,
      };
    },
  }, "computer.observe", { mode: "screenshot" });

  assert.equal(result.isError, false);
  const observe = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.observe");
  const validate = new Ajv({ strict: false }).compile(observe.outputSchema);
  assert.equal(validate(result.structuredContent), true, JSON.stringify(validate.errors));
});

test("screenshot observations return MCP ImageContent without exposing the connector temp path", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const result = await callTool({
    async capture() {
      return {
        status: "ok",
        source: "window-capture",
        artifact: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", mimeType: "image/png" },
        capture: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", width: 800, height: 600 },
      };
    },
    async readOwnedArtifact(filePath) {
      assert.equal(filePath, "C:\\Temp\\agent-computer-use-mcp-private\\window.png");
      return png;
    },
  }, "computer.observe", {
    mode: "visual",
    visualQuestion: "Locate the search field in the current application window.",
  });

  assert.equal(result.isError, false);
  assert.deepEqual(result.content[1], {
    type: "image",
    data: png.toString("base64"),
    mimeType: "image/png",
  });
  assert.equal(result.structuredContent.artifact.delivery, "mcp-image-content");
  assert.equal(result.structuredContent.artifact.path, undefined);
  assert.equal(result.structuredContent.capture.path, undefined);
  assert.equal(result._meta["xiaozhiclaw/visual-understanding"].mode, "auto");
  assert.deepEqual(result._meta["xiaozhiclaw/visual-understanding-capability"], {
    sameTransaction: true,
    requestField: "visualQuestion",
  });
  assert.equal(
    result._meta["xiaozhiclaw/visual-understanding"].instruction,
    "Locate the search field in the current application window.",
  );
  assert.doesNotMatch(JSON.stringify(result), /agent-computer-use-mcp-private/u);
});

test("plain screenshot observations stay structured and omit image model input", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const result = await callTool({
    async capture() {
      return {
        status: "ok",
        artifact: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", mimeType: "image/png" },
        capture: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", width: 800, height: 600 },
      };
    },
    async readOwnedArtifact() {
      return png;
    },
  }, "computer.observe", { mode: "screenshot" });

  assert.equal(result.isError, false);
  assert.equal(result._meta, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.structuredContent.artifact.delivery, undefined);
});

test("unchanged-frame routing omits the Host visual request even when the caller repeats its question", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const result = await callTool({
    async capture() {
      return {
        status: "ok",
        artifact: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", mimeType: "image/png" },
        capture: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", width: 800, height: 600 },
        perceptionRouting: {
          selectedMode: "unchanged-frame",
          visualUnderstandingEligible: false,
          avoidedVision: true,
        },
      };
    },
    async readOwnedArtifact() {
      return png;
    },
  }, "computer.observe", {
    mode: "visual",
    visualQuestion: "Resolve the remaining visual ambiguity.",
  });

  assert.equal(result.isError, false);
  assert.equal(result._meta, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.structuredContent.perceptionRouting.visualUnderstandingEligible, false);
});

test("screenshot ImageContent survives deletion of the private handoff file", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const artifactRoot = await mkdtemp(join(tmpdir(), "computer-use-media-pin-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  );
  let screenshotPath;
  const router = new ComputerUseProviderRouter({
    artifactRoot,
    ocrSession: {
      async start() {},
      async recognize() {
        return { status: "ok", items: [] };
      },
      async close() {},
    },
    driver: {
      async findWindow() {
        return {
          windowId: "window-1",
          title: "Media Test",
          pid: 101,
          bounds: { x: 10, y: 20, width: 320, height: 200 },
        };
      },
      async captureScreenshot({ outputPath }) {
        screenshotPath = outputPath;
        await writeFile(outputPath, png);
        const capture = {
          status: "ok",
          source: "test-capture",
          path: outputPath,
          window: {
            id: "window-1",
            title: "Media Test",
            pid: 101,
            bounds: { x: 10, y: 20, width: 320, height: 200 },
          },
        };
        Object.defineProperty(capture, "artifactBytes", {
          enumerable: false,
          value: png,
        });
        await unlink(outputPath);
        return capture;
      },
    },
  });

  try {
    await router.requestAccess({ titlePart: "Media Test", tier: "observe" });
    const observation = await router.capture({
      mode: "screenshot",
      visualQuestion: "Inspect the current layout.",
    });
    assert.equal(screenshotPath.endsWith("window.png"), true);
    const projected = await projectComputerUseMediaResult(
      router,
      "computer.observe",
      {
        mode: "visual",
        visualQuestion: "Inspect the current layout.",
      },
      observation,
    );
    assert.equal(projected.imageContent[0].data, png.toString("base64"));
    assert.equal(projected.structuredContent.artifact.path, undefined);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("unchanged screenshot digest suppresses repeated Host vision after local OCR", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const artifactRoot = await mkdtemp(join(tmpdir(), "computer-use-observation-budget-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  );
  let ocrCalls = 0;
  const router = new ComputerUseProviderRouter({
    artifactRoot,
    ocrSession: {
      async start() {},
      async recognize() {
        ocrCalls += 1;
        return {
          status: "ok",
          items: [{
            text: "Ready",
            confidence: 0.99,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          }],
        };
      },
      async close() {},
    },
    driver: {
      async findWindow() {
        return {
          windowId: "window-budget",
          title: "Observation Budget",
          pid: 202,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
        };
      },
      async capture() {
        return { observationId: "semantic-empty", elements: [] };
      },
      async captureScreenshot({ outputPath }) {
        await writeFile(outputPath, png);
        return {
          status: "ok",
          path: outputPath,
          width: 1,
          height: 1,
          window: {
            id: "window-budget",
            title: "Observation Budget",
            pid: 202,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          },
        };
      },
    },
  });

  try {
    await router.requestAccess({ titlePart: "Observation Budget", tier: "observe" });
    const first = await router.capture({
      mode: "screenshot",
      visualQuestion: "Resolve the remaining visual ambiguity.",
    });
    const second = await router.capture({
      mode: "screenshot",
      visualQuestion: "Resolve the remaining visual ambiguity.",
    });

    assert.equal(first.perceptionRouting.selectedMode, "window-ocr");
    assert.equal(first.perceptionRouting.ocrFirst, true);
    assert.equal(first.perceptionRouting.visualUnderstandingEligible, true);
    assert.equal(first.localObservation.elements.length, 1);
    assert.equal(second.perceptionRouting.selectedMode, "unchanged-frame");
    assert.equal(second.perceptionRouting.visualUnderstandingEligible, false);
    assert.equal(second.perceptionRouting.avoidedVision, true);
    assert.equal(second.perceptionRouting.reason, "unchanged-frame-visual-already-requested");
    assert.equal(ocrCalls, 1);
  } finally {
    await router.close();
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("unchanged screenshot retries one missing full-window OCR baseline after sidecar startup failure", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const artifactRoot = await mkdtemp(join(tmpdir(), "computer-use-ocr-baseline-retry-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    "base64",
  );
  const ocrRequests = [];
  const router = new ComputerUseProviderRouter({
    artifactRoot,
    ocrSession: {
      async start() {},
      async recognize(request) {
        ocrRequests.push(request);
        if (ocrRequests.length === 1) throw new Error("sidecar warming");
        return {
          status: "ok",
          items: [{
            text: "Blocking overlay",
            confidence: 0.99,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          }],
        };
      },
      async close() {},
    },
    driver: {
      async findWindow() {
        return {
          windowId: "window-baseline-retry",
          title: "Baseline Retry",
          pid: 204,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
        };
      },
      async capture() {
        return { observationId: "semantic-empty", elements: [] };
      },
      async captureScreenshot({ outputPath }) {
        await writeFile(outputPath, png);
        return {
          status: "ok",
          path: outputPath,
          width: 1,
          height: 1,
          window: {
            id: "window-baseline-retry",
            title: "Baseline Retry",
            pid: 204,
            bounds: { x: 0, y: 0, width: 1, height: 1 },
          },
        };
      },
    },
  });

  try {
    await router.requestAccess({ titlePart: "Baseline Retry", tier: "observe" });
    const first = await router.capture({ mode: "screenshot" });
    const second = await router.capture({ mode: "screenshot" });
    const third = await router.capture({ mode: "screenshot" });

    assert.equal(first.perceptionRouting.selectedMode, "window-ocr");
    assert.equal(first.perceptionRouting.baselineOcrRequired, true);
    assert.equal(first.perceptionRouting.baselineOcrAttempts, 1);
    assert.equal(second.perceptionRouting.selectedMode, "window-ocr-baseline-retry");
    assert.equal(second.perceptionRouting.baselineOcrRetry, true);
    assert.equal(second.perceptionRouting.baselineOcrRequired, false);
    assert.equal(second.localObservation.elements[0].name, "Blocking overlay");
    assert.deepEqual(second.localObservation.coordinateBounds, { x: 0, y: 0, width: 1, height: 1 });
    assert.equal(third.perceptionRouting.selectedMode, "unchanged-frame");
    assert.equal(third.perceptionRouting.baselineOcrRetry, false);
    assert.equal(ocrRequests.length, 2);
    assert.equal(ocrRequests.every((request) => request.crop == null), true);
  } finally {
    await router.close();
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("changed screenshots run cropped changed-region OCR before Host vision", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const artifactRoot = await mkdtemp(join(tmpdir(), "computer-use-changed-region-"));
  const baselineCanvas = createCanvas(256, 192);
  const baselineContext = baselineCanvas.getContext("2d");
  baselineContext.fillStyle = "#ffffff";
  baselineContext.fillRect(0, 0, 256, 192);
  const changedCanvas = createCanvas(256, 192);
  const changedContext = changedCanvas.getContext("2d");
  changedContext.fillStyle = "#ffffff";
  changedContext.fillRect(0, 0, 256, 192);
  changedContext.fillStyle = "#000000";
  changedContext.fillRect(40, 24, 12, 10);
  const baseline = baselineCanvas.toBuffer("image/png");
  const changed = changedCanvas.toBuffer("image/png");
  const frames = [baseline, changed];
  const ocrRequests = [];
  const router = new ComputerUseProviderRouter({
    artifactRoot,
    ocrSession: {
      async start() {},
      async recognize(request) {
        ocrRequests.push(request);
        return { status: "ok", items: [] };
      },
      async close() {},
    },
    driver: {
      async findWindow() {
        return {
          windowId: "window-changing",
          title: "Changing Surface",
          pid: 303,
          bounds: { x: 0, y: 0, width: 256, height: 192 },
        };
      },
      async capture() {
        return { observationId: "semantic-empty", elements: [] };
      },
      async captureScreenshot({ outputPath }) {
        await writeFile(outputPath, frames.shift() ?? changed);
        return {
          status: "ok",
          path: outputPath,
          width: 256,
          height: 192,
          window: {
            id: "window-changing",
            title: "Changing Surface",
            pid: 303,
            bounds: { x: 0, y: 0, width: 256, height: 192 },
          },
        };
      },
    },
  });

  try {
    await router.requestAccess({ titlePart: "Changing Surface", tier: "observe" });
    await router.capture({ mode: "screenshot" });
    const second = await router.capture({
      mode: "screenshot",
      visualQuestion: "Resolve the remaining visual ambiguity.",
    });

    assert.equal(second.perceptionRouting.selectedMode, "changed-region-ocr");
    assert.equal(second.perceptionRouting.localCropFirst, true);
    assert.ok(second.perceptionRouting.dirtyRegion.width > 0);
    assert.ok(second.perceptionRouting.ocrRegion.width < 256);
    assert.deepEqual(ocrRequests[1].crop, second.perceptionRouting.ocrRegion);
    assert.equal(ocrRequests[1].timeoutMs, 5_000);
    assert.equal(second.perceptionRouting.visualUnderstandingEligible, true);
  } finally {
    await router.close();
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("OCR observations remain structured-only and omit internal capture paths", async () => {
  const projected = await projectComputerUseMediaResult({}, "computer.observe", { mode: "ocr-region" }, {
    status: "ok",
    imagePath: "C:\\Temp\\agent-computer-use-mcp-private\\window.png",
    capture: { path: "C:\\Temp\\agent-computer-use-mcp-private\\window.png", title: "WeChat" },
    observation: { text: "发送", elements: [{ name: "发送" }] },
  });

  assert.deepEqual(projected.imageContent, []);
  assert.equal(projected.structuredContent.imagePath, undefined);
  assert.equal(projected.structuredContent.capture.path, undefined);
  assert.equal(projected.structuredContent.observation.text, "发送");
});

test("MCP projection keeps OCR grounding compact without weakening the router observation", async () => {
  const fullElement = {
    elementToken: "ocr-1",
    elementIndex: 0,
    role: "text",
    name: "Save",
    value: "Save",
    rawTextSha256: "a".repeat(64),
    state: {},
    actions: ["click"],
    bounds: { x: 10, y: 20, width: 80, height: 24 },
    sourceRegion: { x: 10, y: 20, width: 80, height: 24 },
    confidence: 0.99,
    source: "ocr",
    proposalId: "ocr-proposal-1",
    modelIdentity: {
      provider: "xiaozhiclaw-ocr-sidecar",
      modelPack: "pp-ocrv6-small",
      runtime: "onnxruntime-directml",
    },
    support: [{ provider: "ocr", confidence: 0.99, proposalId: "ocr-proposal-1" }],
    guessedAction: false,
    pixelLimitedAction: true,
  };
  const providerObservation = {
    status: "ok",
    source: "ocr",
    elements: Array.from({ length: 180 }, (_, index) => ({
      ...fullElement,
      elementToken: `ocr-${index + 1}`,
      elementIndex: index,
      name: `Item ${index + 1}`,
      value: `Item ${index + 1}`,
    })),
  };
  providerObservation.text = providerObservation.elements.map((element) => element.name).join("\n");

  const projected = compactComputerUseResult(providerObservation);

  assert.equal(projected.elementCount, 180);
  assert.equal(projected.elements[0].elementToken, undefined);
  assert.deepEqual(projected.elements[0].bounds, fullElement.bounds);
  assert.equal(projected.elements[0].source, "ocr");
  assert.equal(projected.elements[0].observationOnly, true);
  assert.equal(projected.elements[0].role, undefined);
  assert.equal(projected.elements[0].actions, undefined);
  assert.equal(projected.elements[0].confidence, undefined);
  assert.equal(projected.elements[0].modelIdentity, undefined);
  assert.equal(projected.elements[0].rawTextSha256, undefined);
  assert.equal(projected.elements[0].sourceRegion, undefined);
  assert.equal(projected.elements[0].support, undefined);
  assert.equal(projected.text, undefined);
  assert.ok(JSON.stringify(projected).length < 25_000);
  assert.equal(providerObservation.elements[0].modelIdentity.provider, "xiaozhiclaw-ocr-sidecar");
  assert.equal(providerObservation.elements[0].rawTextSha256.length, 64);
});

test("protected imports never auto-start a second stdio server", () => {
  assert.equal(shouldAutoStartComputerUseMcpServer({
    argv: [process.execPath, "D:\\package\\dist\\launcher.mjs"],
    moduleUrl: "file:///D:/package/dist/computer-use-mcp-server.mjs",
    environment: { AGENT_COMPUTER_USE_RELEASE_INTEGRITY_VERIFIED: "1" },
  }), false);
  assert.equal(shouldAutoStartComputerUseMcpServer({
    argv: [process.execPath, "D:\\package\\dist\\computer-use-mcp-server.mjs"],
    moduleUrl: "file:///D:/package/dist/computer-use-mcp-server.mjs",
    environment: {},
  }), true);
});

test("verified platform OCR paths are wired into the sidecar session", () => {
  class FakeSession {
    constructor(options) {
      this.options = options;
    }
  }
  const session = createPlatformOcrSession({
    paths: {
      ocrModelRoot: "D:\\platform\\models\\pp-ocr-v6",
      ocrRuntimeRoot: "D:\\platform\\ocr-runtime",
    },
  }, {
    Session: FakeSession,
    baseEnvironment: { PATH: "C:\\Windows\\System32" },
    platform: "win32",
  });

  assert.equal(session.options.environment.AGENT_COMPUTER_USE_OCR_MODEL_DIR, "D:\\platform\\models\\pp-ocr-v6");
  assert.equal(session.options.environment.AGENT_COMPUTER_USE_OCR_RUNTIME_DIR, "D:\\platform\\ocr-runtime");
  assert.equal(session.options.environment.AGENT_COMPUTER_USE_NETWORK_DISABLED, "1");
});

test("SEA runtime re-enters its embedded OCR sidecar without system Node", () => {
  class FakeSession {
    constructor(options) {
      this.options = options;
    }
  }
  const session = createPlatformOcrSession({
    paths: {
      ocrModelRoot: "D:\\artifact\\ocr\\models",
      ocrRuntimeRoot: "D:\\artifact\\ocr\\runtime",
    },
    ocrProcess: {
      command: "D:\\artifact\\bin\\agent-computer-use-mcp.exe",
      args: [],
      sidecarPath: "--ocr-sidecar",
    },
  }, { Session: FakeSession, platform: "win32" });

  assert.deepEqual(session.options.node, {
    command: "D:\\artifact\\bin\\agent-computer-use-mcp.exe",
    args: [],
    label: "sea",
  });
  assert.equal(session.options.sidecarPath, "--ocr-sidecar");
});

test("agent-computer-use-mcp freezes the local MCP tool contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.name, "agent-computer-use-mcp");
  assert.equal(packageJson.bin["agent-computer-use-mcp"], "src/computer-use-mcp-server.mjs");
  assert.equal(packageJson.scripts["mcp"], "node src/computer-use-mcp-server.mjs");

  const toolNames = COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "computer.acquire",
    "computer.observe",
    "computer.act",
    "computer.release",
    "computer.health",
    "computer.doctor",
    "computer.installation",
    "computer.repair",
  ]);
  assert.deepEqual(
    COMPUTER_USE_MCP_TOOLS.filter((tool) => tool._meta?.["xiaozhiclaw/visibility"] === "host").map((tool) => tool.name),
    ["computer.health", "computer.doctor", "computer.installation", "computer.repair"],
  );

  const health = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.health");
  assert.equal(health.annotations.phase, "0.9");
  assert.equal(health.inputSchema.type, "object");
  assert.equal(health.inputSchema.properties.prewarm.type, "boolean");
  assert.ok(health.outputSchema.properties.capabilityHandshake);

  const doctor = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.doctor");
  assert.equal(doctor.annotations.phase, "2.0");
  assert.equal(doctor.annotations.readOnlyHint, true);
  assert.equal(doctor.inputSchema.properties.fast.type, "boolean");
  assert.equal(doctor.inputSchema.properties.includeInstallCache.type, "boolean");

  const repair = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.repair");
  assert.equal(repair.annotations.phase, "2.1");
  assert.equal(repair.annotations.destructiveHint, true);
  assert.equal(repair.inputSchema.properties.dryRun.type, "boolean");
  assert.equal(repair.inputSchema.properties.approved.type, "boolean");

  const acquire = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.acquire");
  assert.equal(acquire.annotations.phase, "1.3");
  assert.equal(acquire.inputSchema.required, undefined);
  assert.deepEqual(acquire.inputSchema.oneOf, [
    { required: ["windowId"] },
    { required: ["target"] },
    { required: ["applicationToken"] },
  ]);
  assert.equal(acquire.inputSchema.properties.titlePart, undefined);
  assert.deepEqual(acquire.inputSchema.properties.target.enum, ["foreground"]);
  assert.equal(acquire.inputSchema.properties.applicationToken.type, "string");
  assert.deepEqual(acquire._meta["xiaozhiclaw/resourceLifecycle"], {
    schemaVersion: 1,
    operation: "acquire",
    resourceType: "desktop-control",
    scope: "turn",
    cleanupTool: "computer.release",
  });

  const observe = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.observe");
  assert.equal(observe.annotations.readOnlyHint, true);
  assert.deepEqual(observe.inputSchema.properties.mode.enum, ["state", "semantic", "screenshot", "visual", "capture-window", "ocr-region", "diff"]);
  assert.equal(observe.inputSchema.properties.visualQuestion.type, "string");
  assert.ok(observe.outputSchema.properties.foregroundWindow);
  assert.ok(observe.outputSchema.properties.windows);
  assert.ok(observe.outputSchema.properties.windowDiscovery);
  assert.ok(observe.outputSchema.properties.applications);
  assert.ok(observe.outputSchema.properties.applicationDiscovery);
  assert.ok(observe.outputSchema.properties.focusReceipt);
  assert.ok(observe.outputSchema.properties.mutationVerification);
  assert.deepEqual(observe.outputSchema.properties.window, {
    type: "object",
    additionalProperties: true,
  });
  assert.deepEqual(observe.outputSchema.properties.text, { type: "string" });

  const act = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.act");
  assert.equal(act.annotations.phase, "1.3");
  assert.deepEqual(act.inputSchema.required, ["action"]);
  assert.deepEqual(act.outputSchema.allOf[0].else.required, ["status", "provider", "action", "result", "pixelLimitedAction", "execution"]);
  assert.deepEqual(act.outputSchema.allOf[0].then.required, ["status", "error"]);
  assert.deepEqual(act.inputSchema.properties.action.properties.kind.enum, ["activate_window", "set_value", "type_text", "click", "press_key"]);
  assert.equal(act.inputSchema.properties.action.properties.focusReceiptId.type, "string");
  assert.deepEqual(act.inputSchema.properties.action.properties.coordinateSpace.enum, ["window-local", "screen"]);
  assert.deepEqual(
    act.inputSchema.properties.action.properties.inputBehavior.enum,
    ["incremental", "commit"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.allOf[2].then.required,
    ["textMode", "inputBehavior"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.allOf[3].then.required,
    ["targetBounds"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.allOf[4].then.required,
    ["targetBounds"],
  );
  assert.equal(act.inputSchema.properties.action.properties.inputBehavior.default, undefined);
  assert.deepEqual(
    act.inputSchema.properties.action.allOf[0].then.required,
    ["observationId", "x", "y", "coordinateSpace"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.allOf[1].then.required,
    ["interactionIntent", "targetRole"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.properties.interactionIntent.enum,
    ["activate-control", "select-item"],
  );
  assert.deepEqual(
    act.inputSchema.properties.action.properties.targetRole.enum,
    ["button", "list-item", "menu-item", "toggle", "editable", "other"],
  );
  assert.equal(act.inputSchema.properties.action.properties.observationId.type, "string");
  assert.equal(act.inputSchema.properties.action.properties.x.type, "number");
  assert.equal(act.inputSchema.properties.action.properties.y.type, "number");
  assert.deepEqual(
    act.inputSchema.properties.action.properties.targetBounds.required,
    ["x", "y", "width", "height"],
  );
  assert.equal(act.inputSchema.properties.action.properties.key.type, "string");
  assert.deepEqual(observe.outputSchema.properties.expiresAt, {
    anyOf: [{ type: "number" }, { type: "null" }],
  });

  for (const field of ["elements", "controllerId", "expiresAt", "dirtyRegion", "observation"]) {
    assert.ok(observe.outputSchema.properties[field], `computer.observe declares ${field}`);
  }

  for (const tool of COMPUTER_USE_MCP_TOOLS.slice(0, 4)) {
    const capability = tool._meta?.["xiaozhiclaw/semanticCapability"];
    assert.equal(capability?.schemaVersion, 1, `${tool.name} declares a versioned semantic capability`);
    assert.equal(typeof capability?.summary, "string", `${tool.name} declares a semantic summary`);
    assert.ok(capability.summary.length > 0, `${tool.name} semantic summary is non-empty`);
    assert.ok(Array.isArray(capability.modalities), `${tool.name} declares supported modalities`);
  }

  const release = COMPUTER_USE_MCP_TOOLS.find((tool) => tool.name === "computer.release");
  assert.deepEqual(release._meta["xiaozhiclaw/resourceLifecycle"], {
    schemaVersion: 1,
    operation: "release",
    resourceType: "desktop-control",
    scope: "turn",
  });
});

test("agent-computer-use-mcp answers initialize, tools/list, and health over stdio", async () => {
  const client = createSdkClient("computer-use-mcp-test");

  try {
    await client.connect();
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      "computer.acquire",
      "computer.observe",
      "computer.act",
      "computer.release",
      "computer.health",
      "computer.doctor",
      "computer.installation",
      "computer.repair",
    ]);
    for (const tool of listed.tools.slice(0, 4)) {
      assert.equal(
        tool._meta?.["xiaozhiclaw/semanticCapability"]?.schemaVersion,
        1,
        `${tool.name} publishes semantic capability metadata over standard MCP`,
      );
    }

    const health = await client.callTool({
      name: "computer.health",
      arguments: { fast: true },
    });
    assert.equal(health.structuredContent.module, "agent-computer-use-mcp");
    assert.equal(health.structuredContent.status, "ready");
    assert.equal(health.structuredContent.phases["0.9"], "contract-freeze");
    assert.equal(health.structuredContent.phases["1.0"], "stdio-mcp-server");
    assert.equal(health.structuredContent.phases["1.1"], "provider-router");
    assert.equal(health.structuredContent.phases["1.2"], "packaging-health-contract");
    assert.equal(health.structuredContent.phases["1.5"], "safety-diagnostics");
    assert.equal(health.structuredContent.phases["1.6"], "install-config-contract");
    assert.deepEqual(health.structuredContent.actionPolicy.deliveryModes, ["background", "foreground"]);

    const doctor = await client.callTool({
      name: "computer.doctor",
      arguments: { fast: true, includeInstallCache: true },
    });
    assert.equal(doctor.structuredContent.module, "agent-computer-use-mcp");
    assert.equal(["healthy", "degraded", "unavailable"].includes(doctor.structuredContent.status), true);
    assert.equal(doctor.structuredContent.includeUserOverlay, false);
    assert.equal(doctor.structuredContent.startsDesktopControl, false);
    assert.equal(Array.isArray(doctor.structuredContent.repairPlan.actions), true);
    assert.equal(doctor.structuredContent.installCache.includeUserOverlay, false);
    assert.equal(doctor.structuredContent.installCache.startsDesktopControl, false);

    const repair = await client.callTool({
      name: "computer.repair",
      arguments: { dryRun: false, approved: false },
    });
    assert.equal(repair.isError, false);
    assert.equal(repair.structuredContent.status, "approval_required");
    assert.equal(repair.structuredContent.mode, "plan-only");
    assert.equal(repair.structuredContent.executesImmediately, false);
    assert.equal(repair.structuredContent.includeUserOverlay, false);
    assert.equal(repair.structuredContent.startsDesktopControl, false);
    assert.equal(Array.isArray(repair.structuredContent.repairPlan.actions), true);

    const missingController = await client.callTool({
      name: "computer.observe",
      arguments: { mode: "semantic" },
    });
    assert.equal(missingController.isError, true);
    assert.equal(missingController.structuredContent.error.code, "controller.required");
    assert.equal(missingController.structuredContent.includeUserOverlay, false);

    const stateAfterFailure = await client.callTool({
      name: "computer.observe",
      arguments: { mode: "state" },
    });
    assert.equal(stateAfterFailure.isError, false);
    assert.equal(stateAfterFailure.structuredContent.status, "idle");
    assert.equal(stateAfterFailure.structuredContent.startsDesktopControl, false);
    assert.equal(
      stateAfterFailure.structuredContent.auditEvents.some(
        (event) => event.type === "computer.cancelled",
      ),
      false,
    );
  } finally {
    await client.close();
  }
});

test("provider router prewarms OCR buckets during non-fast health", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    ocrSession: {
      async start() {
        calls.push({ method: "start" });
      },
      async doctor() {
        calls.push({ method: "doctor" });
        return { status: "healthy", runtime: "fake-ort" };
      },
      async recognize(request) {
        calls.push({ method: "recognize", request });
        return {
          status: "ok",
          items: [{ text: "Status", bounds: { x: 0, y: 0, width: 60, height: 24 }, confidence: 1 }],
          timings: { totalMs: 1 },
        };
      },
      async close() {
        calls.push({ method: "close" });
      },
    },
  });

  const health = await router.health({ fast: false, prewarm: true });

  assert.equal(health.prewarm.status, "completed");
  assert.equal(health.capabilityHandshake.schemaVersion, 1);
  assert.equal(health.capabilityHandshake.module.resultSchemaVersion, "5.5");
  assert.equal(health.capabilityHandshake.supports.observation.focusedElementMetadata, true);
  assert.equal(health.capabilityHandshake.supports.action.executionPathMetadata, true);
  assert.deepEqual(health.prewarm.buckets.map((bucket) => bucket.size), ["128x96", "288x96", "704x320"]);
  assert.equal(calls.filter((call) => call.method === "recognize").length, 3);
  assert.equal(calls.find((call) => call.method === "recognize").request.fixture, "canvas-lab");
  await router.close();
});

test("provider router manages request/capture/action/cancel lifecycle", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const driver = {
    async findWindow(args) {
      calls.push({ method: "findWindow", args });
      return { windowId: "win-1", title: "Computer Use Lab", pid: 123, bounds: { x: 10, y: 20, width: 300, height: 180 } };
    },
    async capture(args) {
      calls.push({ method: "capture", args });
      return {
        observationId: "obs-1",
        provider: "gateway-managed",
        source: "cua-driver",
        mode: args.mode,
        elements: [
          { elementToken: "name", role: "Edit", name: "Name", actions: ["set_value"] },
          { elementToken: "document", role: "Document", name: "Text editor", actions: ["type_text"] },
          { elementToken: "save", role: "Button", name: "Save", actions: ["click"] },
        ],
        includeUserOverlay: false,
      };
    },
    async setValue(args) {
      calls.push({ method: "setValue", args });
      return { status: "ok", action: "set_value" };
    },
    async typeText(args) {
      calls.push({ method: "typeText", args });
      return { status: "ok", action: "type_text", verify: "confirmed" };
    },
    async click(args) {
      calls.push({ method: "click", args });
      return { status: "ok", action: "click" };
    },
  };
  const overlayCalls = [];
  const router = new ComputerUseProviderRouter({
    driver,
    overlayRuntime: {
      async start(args) {
        overlayCalls.push({ method: "start", args });
        return { visible: true, processId: 99, targetRectFile: "target.json" };
      },
      async stop(handle) {
        overlayCalls.push({ method: "stop", handle });
      },
    },
  });

  const access = await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full", agentId: "agent-1" });
  assert.equal(access.status, "granted");
  assert.equal(access.controller.provider, "gateway-managed");
  assert.equal(access.overlay.visible, true);

  const observation = await router.capture({ mode: "semantic" });
  assert.equal(observation.includeUserOverlay, false);
  assert.equal(observation.elements.length, 3);

  const action = await router.act({ action: { kind: "set_value", elementToken: "name", value: "xiaozhi" } });
  assert.equal(action.status, "ok");
  assert.equal(action.pixelLimitedAction, false);
  assert.deepEqual(action.execution, {
    schemaVersion: 1,
    targetPath: "semantic-element",
    providerPath: "cua-driver-mcp",
    deliveryMode: "background",
    selectionReason: null,
    fallback: { used: false, reason: null },
  });
  await router.capture({ mode: "semantic" });
  const typed = await router.act({
    action: {
      kind: "type_text",
      elementToken: "document",
      value: "Notepad text",
      textMode: "insert",
    },
  });
  assert.equal(typed.result.verify, "confirmed");

  const state = await router.listState();
  assert.equal(state.activeController.window.title, "Computer Use Lab");
  assert.equal(state.lastCapture.observationId, "obs-1");
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.action.completed"), true);

  const cancelled = await router.cancel({ reason: "test" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await router.listState()).activeController, null);
  assert.deepEqual(overlayCalls.map((call) => call.method), ["start", "stop"]);
  assert.deepEqual(calls.map((call) => call.method), ["findWindow", "capture", "setValue", "capture", "typeText"]);
});

test("provider router fails closed on a secure Windows input desktop", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let findWindowCalls = 0;
  const router = new ComputerUseProviderRouter({
    driver: {
      async desktopState() {
        return {
          status: "locked",
          inputDesktop: "Winlogon",
          secureDesktop: true,
        };
      },
      async findWindow() {
        findWindowCalls += 1;
        return { windowId: 42, title: "Fixture", pid: 1234 };
      },
    },
  });

  await assert.rejects(
    router.requestAccess({ titlePart: "Fixture", tier: "full", agentId: "agent-1" }),
    (error) => (
      error.code === "desktop.locked"
      && error.detail?.terminal === true
      && error.detail?.requiresUserAction === "unlock"
    ),
  );
  assert.equal(findWindowCalls, 0);

  const state = await router.listState();
  assert.equal(state.status, "blocked");
  assert.equal(state.blocker.code, "desktop.locked");
  assert.equal(state.desktopState.inputDesktop, "Winlogon");
  await router.close();
});

test("provider router activates the acquired window without perception coordinates", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        return { windowId: 42, title: "Background App", pid: 1234 };
      },
      async activateWindow(args) {
        calls.push(args);
        return {
          status: "ok",
          effect: "applied",
          verified: true,
          foregroundWindow: { windowId: 42, title: "Background App", pid: 1234, isForeground: true },
          driverActivation: {
            status: "ok",
            landed_on_target: false,
          },
        };
      },
    },
    overlayRuntime: {
      async start() {
        return { visible: true };
      },
      async stop() {},
    },
  });

  await router.requestAccess({ titlePart: "Background App", tier: "full", agentId: "agent-1" });
  const activated = await router.act({ action: { kind: "activate_window" } });

  assert.equal(activated.status, "ok");
  assert.equal(activated.outcome, "applied");
  assert.equal(activated.effectiveDeliveryMode, "foreground");
  assert.equal(activated.pixelLimitedAction, false);
  assert.deepEqual(activated.execution, {
    schemaVersion: 1,
    targetPath: "controller-window",
    providerPath: "windows-foreground-bridge",
    deliveryMode: "foreground",
    selectionReason: null,
    fallback: { used: true, reason: "cua-driver-foreground-not-confirmed" },
  });
  assert.equal(activated.focusReceipt.status, "verified");
  assert.equal(activated.focusReceipt.target.kind, "activate_window");
  assert.deepEqual(calls, [{
    window: { windowId: 42, title: "Background App", pid: 1234 },
  }]);
  await router.cancel({ reason: "test-complete" });
});

test("provider router exposes foreground discovery without acquiring or cancelling control", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const windows = [
    {
      windowId: 11,
      title: "Frontmost Editor",
      appName: "editor.exe",
      pid: 101,
      zIndex: 9,
      isOnScreen: true,
      isForeground: true,
      bounds: { x: 10, y: 20, width: 900, height: 700 },
    },
    {
      windowId: 12,
      title: "Background Notes",
      appName: "notes.exe",
      pid: 102,
      zIndex: 3,
      isOnScreen: true,
      isForeground: false,
      bounds: { x: 30, y: 40, width: 600, height: 500 },
    },
  ];
  const router = new ComputerUseProviderRouter({
    driver: {
      async listWindows(args) {
        calls.push({ method: "listWindows", args });
        return windows;
      },
      async findWindow(args) {
        calls.push({ method: "findWindow", args });
        return windows[0];
      },
    },
  });

  const state = await router.listState();
  assert.equal(state.status, "idle");
  assert.deepEqual(state.foregroundWindow, windows[0]);
  assert.deepEqual(state.windows, windows);
  assert.deepEqual(state.windowDiscovery, { status: "ready", source: "cua-driver" });
  assert.equal(state.startsDesktopControl, false);
  assert.equal(state.auditEvents.some((event) => event.type === "computer.cancelled"), false);

  const access = await router.requestAccess({ target: "foreground", tier: "observe" });
  assert.equal(access.status, "granted");
  assert.deepEqual(calls, [
    { method: "listWindows", args: { onScreenOnly: false } },
    { method: "findWindow", args: { target: "foreground", windowId: undefined, titlePart: undefined } },
  ]);
});

test("provider router renews an identical controller request instead of failing already_active", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let now = 1_000;
  const overlayCalls = [];
  const router = new ComputerUseProviderRouter({
    clock: { now: () => now, iso: (value = now) => new Date(value).toISOString() },
    driver: {
      async findWindow() {
        return { windowId: "win-1", title: "Computer Use Lab", bounds: { x: 0, y: 0, width: 300, height: 200 } };
      },
    },
    overlayRuntime: {
      async start() { overlayCalls.push("start"); return { visible: true }; },
      async stop() { overlayCalls.push("stop"); },
    },
  });

  const requestContext = { schemaVersion: 1, ownerId: "owner-1", agentId: "agent-1", projectId: "project-1", sessionId: "session-1" };
  const first = await router.requestAccess({ target: "foreground", tier: "observe", agentId: "spoofed-agent", leaseTtlMs: 1_000, requestContext });
  now = 1_500;
  const renewed = await router.requestAccess({ target: "foreground", tier: "observe", leaseTtlMs: 2_000, requestContext });

  assert.equal(renewed.status, "reused");
  assert.equal(renewed.reused, true);
  assert.equal(renewed.controller.controllerId, first.controller.controllerId);
  assert.equal(renewed.controller.agentId, "agent-1");
  assert.equal("requestContext" in renewed.controller, false);
  assert.equal(renewed.controller.expiresAtMs, 3_500);
  assert.equal(renewed.startsDesktopControl, false);
  assert.deepEqual(overlayCalls, ["start"]);
  await assert.rejects(
    () => router.capture({ mode: "semantic", requestContext: { ...requestContext, sessionId: "session-2" } }),
    { code: "controller.lease_mismatch" },
  );
  await router.close();
});

test("semantic action verification preserves the active Host request context", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let captureCount = 0;
  const router = new ComputerUseProviderRouter({
    driver: {
      async findWindow() {
        return {
          windowId: "window-context",
          title: "Context App",
          pid: 101,
          bounds: { x: 0, y: 0, width: 320, height: 200 },
        };
      },
      async capture() {
        captureCount += 1;
        return {
          observationId: `observation-${captureCount}`,
          source: "cua-driver",
          mode: "semantic",
          elements: [{
            elementToken: "activate",
            role: "Button",
            name: captureCount === 1 ? "Enter" : "Entered",
            actions: ["click"],
          }],
        };
      },
      async click() {
        return {
          status: "ok",
          effect: "delivered_unobserved",
          verified: false,
          delivered: true,
        };
      },
    },
  });
  const requestContext = {
    schemaVersion: 1,
    ownerId: "owner-1",
    agentId: "agent-1",
    projectId: "project-1",
    sessionId: "session-1",
  };

  await router.requestAccess({
    titlePart: "Context App",
    tier: "full",
    requestContext,
  });
  await router.capture({ mode: "semantic", requestContext });
  const action = await router.act({
    action: {
      kind: "click",
      elementToken: "activate",
      interactionIntent: "activate-control",
    },
    requestContext,
  });

  assert.equal(action.status, "ok");
  assert.equal(action.result.effect, "verified");
  assert.equal(action.result.verification.status, "changed");
  assert.equal(action.result.verification.error, undefined);
  assert.equal(captureCount, 2);
  await router.close({ requestContext });
});

test("state observation projects opaque application tokens that acquire can use to restore a window", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const router = new ComputerUseProviderRouter({
    driver: {
      async listWindows() {
        return [];
      },
      async listApps() {
        return [{
          name: "Restorable App",
          kind: "desktop",
          running: true,
          active: false,
          pid: 101,
          lastUsed: "2026-07-30T00:00:00Z",
          launchPath: "C:\\private\\restorable.exe",
        }];
      },
      async launchApp(args) {
        calls.push(args);
        return {
          status: "launched",
          pid: 101,
          windows: [{
            windowId: "restored-window",
            title: "Restored App",
            pid: 101,
            bounds: { x: 10, y: 20, width: 640, height: 480 },
          }],
        };
      },
    },
  });

  const state = await router.listState();
  assert.equal(state.applicationDiscovery.status, "ready");
  assert.equal(state.applications.length, 1);
  assert.match(state.applications[0].applicationToken, /^application-/u);
  assert.equal(JSON.stringify(state).includes("C:\\private"), false);

  const access = await router.requestAccess({
    applicationToken: state.applications[0].applicationToken,
    titlePart: "redundant stale title hint",
    tier: "observe",
  });
  assert.equal(access.status, "granted");
  assert.equal(access.controller.window.windowId, "restored-window");
  assert.deepEqual(calls, [{
    launchPath: "C:\\private\\restorable.exe",
    name: "Restorable App",
    pid: 101,
    running: true,
  }]);
});

test("same-Agent acquire retries reuse or retarget the lease and active observations renew its idle timeout", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  let now = 1_000;
  let foregroundWindow = {
    windowId: "window-a",
    title: "Window A",
    pid: 101,
    bounds: { x: 10, y: 20, width: 300, height: 180 },
  };
  const visualCalls = [];
  const router = new ComputerUseProviderRouter({
    clock: {
      now: () => now,
      iso: (timeMs = now) => new Date(timeMs).toISOString(),
    },
    driver: {
      async findWindow() {
        return foregroundWindow;
      },
      async capture() {
        return {
          observationId: `observation-${now}`,
          elements: [],
          includeUserOverlay: false,
        };
      },
      async startCursor() {
        visualCalls.push("cursor.start");
      },
      async stopCursor() {
        visualCalls.push("cursor.stop");
      },
    },
    overlayRuntime: {
      async start({ targetRect }) {
        visualCalls.push(`overlay.start:${targetRect.windowId}`);
        return { visible: true, windowId: targetRect.windowId };
      },
      async stop(handle) {
        visualCalls.push(`overlay.stop:${handle.windowId}`);
      },
    },
  });

  const first = await router.requestAccess({
    target: "foreground",
    tier: "full",
    leaseTtlMs: 50,
  });
  now = 1_025;
  await router.capture({ mode: "semantic" });
  assert.equal((await router.listState()).activeController.expiresAt, new Date(1_075).toISOString());

  now = 1_051;
  const reused = await router.requestAccess({
    target: "foreground",
    tier: "full",
    leaseTtlMs: 50,
  });
  assert.equal(reused.status, "reused");
  assert.equal(reused.controller.controllerId, first.controller.controllerId);
  assert.equal(reused.startsDesktopControl, false);
  assert.deepEqual(visualCalls, ["cursor.start", "overlay.start:window-a"]);

  foregroundWindow = {
    windowId: "window-b",
    title: "Window B",
    pid: 101,
    bounds: { x: 30, y: 40, width: 500, height: 320 },
  };
  const retargeted = await router.requestAccess({
    target: "foreground",
    tier: "full",
    leaseTtlMs: 50,
  });
  assert.equal(retargeted.status, "granted");
  assert.notEqual(retargeted.controller.controllerId, first.controller.controllerId);
  assert.equal(retargeted.controller.window.windowId, "window-b");
  assert.deepEqual(visualCalls, [
    "cursor.start",
    "overlay.start:window-a",
    "overlay.stop:window-a",
    "cursor.stop",
    "cursor.start",
    "overlay.start:window-b",
  ]);
  assert.equal(
    (await router.listState()).auditEvents.some((event) => event.type === "computer.access.replaced"),
    true,
  );

  await assert.rejects(
    () => router.requestAccess({
      target: "foreground",
      tier: "full",
      agentId: "different-agent",
    }),
    { code: "controller.already_active" },
  );
});

test("failed window resolution remains a tool failure and never cancels the controller lifecycle", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const router = new ComputerUseProviderRouter({
    driver: {
      async listWindows() {
        return [];
      },
      async findWindow() {
        const error = new Error("window.not_found: Missing App");
        error.code = "window.not_found";
        throw error;
      },
    },
  });

  await assert.rejects(
    () => router.requestAccess({ titlePart: "Missing App", tier: "observe" }),
    { code: "window.not_found" },
  );
  const state = await router.listState();
  assert.equal(state.status, "idle");
  assert.equal(state.activeController, null);
  assert.equal(state.auditEvents.some((event) => event.type === "computer.cancelled"), false);
});

test("provider router enforces action safety policy", async () => {
  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const calls = [];
  const driver = {
    async findWindow() {
      return { windowId: "win-1", title: "Computer Use Lab", pid: 123, bounds: { x: 10, y: 20, width: 300, height: 180 } };
    },
    async click(args) {
      calls.push({ method: "click", args });
      return { status: "ok" };
    },
  };
  const router = new ComputerUseProviderRouter({ driver });

  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "observe" });
  await assert.rejects(
    () => router.act({ action: { kind: "click", elementIndex: 1 } }),
    /observe-only access/,
  );
  assert.deepEqual(calls, []);

  await router.cancel({ reason: "switch-tier" });
  await router.requestAccess({ titlePart: "Computer Use Lab", tier: "full" });
  await assert.rejects(
    () => router.act({ action: { kind: "click", deliveryMode: "teleport", elementIndex: 1 } }),
    /Unsupported delivery mode/,
  );
  await assert.rejects(
    () => router.act({ action: { kind: "set_value", elementIndex: 0 } }),
    /require.*string value/,
  );

  const state = await router.listState();
  assert.equal(state.auditEvents.map((event) => event.type).includes("computer.action.failed"), false);
});

function createSdkClient(name) {
  const client = new Client({ name, version: "0.0.1" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/computer-use-mcp-server.mjs"],
    cwd: process.cwd(),
  });
  return {
    connect: () => client.connect(transport),
    listTools: () => client.listTools(),
    callTool: (request) => client.callTool(request),
    close: () => client.close(),
  };
}
