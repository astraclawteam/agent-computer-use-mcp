import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { normalizeOcrSidecarResponse } from "../src/ocr-sidecar.mjs";
import { normalizeUiText } from "../src/perception-benchmark-metrics.mjs";
import { UI_TEXT_NORMALIZATION_VERSION, normalizeRecognizedUiText } from "../src/ui-text-normalization.mjs";

test("UI text normalization is deterministic across Unicode and whitespace forms", () => {
  assert.equal(UI_TEXT_NORMALIZATION_VERSION, "ui-text-v1");
  assert.equal(normalizeRecognizedUiText("  Ｓａｖｅ\r\n １２５．５０\t", { languageClass: "mixed" }), "Save 125.50");
  assert.equal(normalizeRecognizedUiText("保\u200B存\u2060 Save\uFEFF", { languageClass: "mixed" }), "保存 Save");
  assert.equal(normalizeRecognizedUiText("\u3000文件(&F)：保存？\u3000", { languageClass: "chinese" }), "文件(&F):保存?");
});

test("normalization preserves meaningful punctuation and never performs fuzzy correction", () => {
  assert.equal(normalizeRecognizedUiText("Svae... [A/B]", { languageClass: "english" }), "Svae... [A/B]");
  assert.equal(normalizeRecognizedUiText("轨道 A1 - 02:30", { languageClass: "mixed" }), "轨道 A1 - 02:30");
  assert.notEqual(normalizeRecognizedUiText("Svae", { languageClass: "english" }), "Save");
});

test("runtime OCR and benchmark metrics share the same normalizer", () => {
  const raw = "\u200B Ｓａｖｅ\r\n As ";
  const observation = normalizeOcrSidecarResponse({
    provider: "xiaozhiclaw-ocr-sidecar",
    modelPack: "pp-ocrv6-small",
    modelFormat: "onnx",
    items: [{ text: raw, bounds: { x: 1, y: 2, width: 20, height: 10 }, confidence: 0.99 }],
  }, { languageClass: "english" });

  assert.equal(observation.elements[0].name, "Save As");
  assert.equal(observation.elements[0].value, "Save As");
  assert.equal(observation.elements[0].rawTextSha256, createHash("sha256").update(raw, "utf8").digest("hex"));
  assert.equal(JSON.stringify(observation).includes(raw), false);
  assert.equal(normalizeUiText(raw, "english"), observation.elements[0].name);
});

test("normalization rejects unsupported language classes and non-string input", () => {
  assert.throws(() => normalizeRecognizedUiText("Save", { languageClass: "unknown" }), /perception\.metric_language_invalid/u);
  assert.throws(() => normalizeRecognizedUiText(null, { languageClass: "mixed" }), /perception\.metric_text_invalid/u);
});
