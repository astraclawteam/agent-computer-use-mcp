import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeOcrSidecarResponse,
  resolveOcrSidecarPath,
  selectOcrRuntime,
} from "../src/ocr-sidecar.mjs";

test("OCR sidecar path prefers explicit and protected release paths", () => {
  assert.equal(resolveOcrSidecarPath({
    env: { AGENT_COMPUTER_USE_OCR_SIDECAR_PATH: "D:\\runtime\\ocr-sidecar.mjs" },
    moduleDirectory: "C:\\package\\dist",
    pathExists: () => false,
  }), "D:\\runtime\\ocr-sidecar.mjs");

  assert.equal(resolveOcrSidecarPath({
    env: {},
    moduleDirectory: "C:\\package\\dist",
    pathExists: (path) => path === "C:\\package\\dist\\ocr-sidecar.mjs",
  }), "C:\\package\\dist\\ocr-sidecar.mjs");

  assert.equal(resolveOcrSidecarPath({
    env: {},
    moduleDirectory: "C:\\package\\src",
    pathExists: () => false,
  }), "C:\\package\\ocr-sidecar\\xiaozhiclaw_ocr_sidecar_native.mjs");
});

test("OCR runtime selection prefers GPU providers before CPU fallback", () => {
  assert.deepEqual(
    selectOcrRuntime(["CPUExecutionProvider", "CUDAExecutionProvider"]),
    {
      runtime: "onnxruntime-cuda",
      executionProvider: "CUDAExecutionProvider",
      acceleration: "gpu",
      rapidOcrParams: {
        "EngineConfig.onnxruntime.use_cuda": true,
      },
    },
  );

  assert.deepEqual(
    selectOcrRuntime(["DmlExecutionProvider", "CPUExecutionProvider"]),
    {
      runtime: "onnxruntime-directml",
      executionProvider: "DmlExecutionProvider",
      acceleration: "gpu",
      rapidOcrParams: {
        "EngineConfig.onnxruntime.use_dml": true,
      },
    },
  );
});

test("OCR runtime selection uses other compute cores before plain CPU", () => {
  assert.deepEqual(
    selectOcrRuntime(["CoreMLExecutionProvider", "CPUExecutionProvider"]),
    {
      runtime: "onnxruntime-coreml",
      executionProvider: "CoreMLExecutionProvider",
      acceleration: "accelerator",
      rapidOcrParams: {
        "EngineConfig.onnxruntime.use_coreml": true,
      },
    },
  );

  assert.deepEqual(
    selectOcrRuntime(["AzureExecutionProvider", "CPUExecutionProvider"]),
    {
      runtime: "onnxruntime-cpu",
      executionProvider: "CPUExecutionProvider",
      acceleration: "cpu",
      rapidOcrParams: {},
    },
  );
});

test("OCR sidecar response is merged as pixel-limited OCR observation elements", () => {
  const observation = normalizeOcrSidecarResponse({
    provider: "xiaozhiclaw-ocr-sidecar",
    modelPack: "pp-ocrv6-small",
    runtime: "onnxruntime-cpu",
    items: [
      {
        text: "Save",
        bounds: { x: 640, y: 228, width: 62, height: 30 },
        confidence: 0.99,
        source: "ocr",
      },
    ],
    timings: { preprocessMs: 1, inferMs: 1200, postprocessMs: 2, totalMs: 1203 },
  });

  assert.equal(observation.provider, "gateway-managed");
  assert.equal(observation.source, "ocr");
  assert.equal(observation.mode, "ocr");
  assert.equal(observation.includeUserOverlay, false);
  assert.equal(observation.elements[0].elementToken, "ocr-1");
  assert.equal(observation.elements[0].role, "text");
  assert.equal(observation.elements[0].name, "Save");
  assert.deepEqual(observation.elements[0].bounds, { x: 640, y: 228, width: 62, height: 30 });
  assert.equal(observation.elements[0].pixelLimitedAction, true);
  assert.equal(observation.elements[0].source, "ocr");
});
