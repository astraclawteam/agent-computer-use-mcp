import assert from "node:assert/strict";
import { test } from "node:test";

import { createPhase07Report } from "../src/phase-0-7-report.mjs";

test("Phase 0.7 report blocks OCR execution when sidecar dependencies are unavailable", () => {
  const report = createPhase07Report({
    doctor: {
      status: "unavailable",
      reason: "missing-python-or-rapidocr",
      detail: "rapidocr import failed",
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.steps[0].name, "OCR sidecar doctor");
  assert.equal(report.steps[0].status, "blocked");
  assert.match(report.nextAction, /install local OCR sidecar/i);
});

test("Phase 0.7 report is ready after selecting an OCR compute runtime", () => {
  const report = createPhase07Report({
    doctor: {
      status: "healthy",
      provider: "xiaozhiclaw-ocr-sidecar",
      modelPack: "pp-ocrv6-small",
      runtime: "onnxruntime-directml",
      executionProvider: "DmlExecutionProvider",
      acceleration: "gpu",
      availableProviders: ["DmlExecutionProvider", "CPUExecutionProvider"],
    },
  });

  assert.equal(report.status, "ready");
  assert.equal(report.steps[0].status, "passed");
  assert.equal(report.steps[1].name, "Canvas/self-drawn Lab fixture");
  assert.equal(report.steps[2].name, "OCR capture");
  assert.match(report.nextAction, /run OCR capture/i);
});
