import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateOcrMetrics,
  calculateProposalMetrics,
  normalizeUiText,
} from "../src/perception-benchmark-metrics.mjs";

test("UI text normalization is NFKC and whitespace-stable without deleting punctuation", () => {
  assert.equal(normalizeUiText("  Save\r\n  As…  ", "english"), "Save As...");
  assert.equal(normalizeUiText("１２５．５０", "numeric"), "125.50");
  assert.equal(normalizeUiText("轨道　Ａ１", "mixed"), "轨道 A1");
  assert.equal(normalizeUiText("文件(&F)：保存？", "chinese"), "文件(&F):保存?");
  assert.throws(() => normalizeUiText("Save", "unknown"), /perception\.metric_language_invalid/u);
});

test("OCR metrics use Unicode code-point edit distance and exact critical-label recall", () => {
  const metrics = calculateOcrMetrics([
    sample("cn", "保存", "保仔", "chinese", true, 50),
    sample("en", "Save", "Save", "english", true, 80),
    sample("num", "１２５", "125", "numeric", false, 120),
    sample("mixed", "轨道 A1", "轨道 A1", "mixed", true, 180),
  ]);

  assert.equal(metrics.totalSamples, 4);
  assert.equal(metrics.totalExpectedCodePoints, 14);
  assert.equal(metrics.totalEditDistance, 1);
  assert.equal(metrics.characterAccuracy, 13 / 14);
  assert.equal(metrics.criticalLabels, 3);
  assert.equal(metrics.criticalLabelMatches, 2);
  assert.equal(metrics.criticalLabelRecall, 2 / 3);
  assert.equal(metrics.p95Ms, 180);
  assert.deepEqual(metrics.regressions, [{
    sampleId: "cn",
    failures: [{ code: "ocr.text-mismatch" }, { code: "ocr.critical-label-missed" }],
  }]);
});

test("OCR errors count as empty output and nearest-rank P95 is deterministic", () => {
  const samples = Array.from({ length: 20 }, (_, index) => sample(
    `sample-${index}`,
    "A",
    index === 0 ? "" : "A",
    "english",
    index === 0,
    index + 1,
    index === 0 ? "provider.crashed" : undefined,
  ));
  const metrics = calculateOcrMetrics(samples);

  assert.equal(metrics.failedSamples, 1);
  assert.equal(metrics.characterAccuracy, 0.95);
  assert.equal(metrics.criticalLabelRecall, 0);
  assert.equal(metrics.p95Ms, 19);
});

test("proposal metrics match one-to-one by descending confidence", () => {
  const first = { x: 10, y: 10, width: 40, height: 24 };
  const second = { x: 80, y: 10, width: 30, height: 30 };
  const ignored = { x: 140, y: 10, width: 20, height: 20 };
  const metrics = calculateProposalMetrics([{
    sampleId: "scene-1",
    expected: [{ box: first }, { box: second }],
    ignored: [{ box: ignored }],
    proposals: [
      { box: first, confidence: 0.99, guessedAction: false },
      { box: second, confidence: 0.98, guessedAction: false },
      { box: first, confidence: 0.80, guessedAction: true },
      { box: ignored, confidence: 0.70, guessedAction: false },
    ],
    durationMs: 42,
  }], { iouThreshold: 0.5 });

  assert.equal(metrics.expectedTargets, 2);
  assert.equal(metrics.truePositives, 2);
  assert.equal(metrics.falsePositives, 1);
  assert.equal(metrics.falseNegatives, 0);
  assert.equal(metrics.ignoredProposals, 1);
  assert.equal(metrics.precision, 2 / 3);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.guessedActionCount, 1);
  assert.equal(metrics.p95Ms, 42);
  assert.deepEqual(metrics.regressions, [{
    sampleId: "scene-1",
    failures: [{ code: "proposal.false-positive" }, { code: "proposal.guessed-action" }],
  }]);
});

test("proposal metrics retain provider failures and reject invalid boxes", () => {
  const metrics = calculateProposalMetrics([
    {
      sampleId: "failed",
      expected: [{ box: { x: 0, y: 0, width: 10, height: 10 } }],
      ignored: [],
      proposals: [],
      durationMs: 9,
      error: "provider.crashed",
    },
  ], { iouThreshold: 0.5 });
  assert.equal(metrics.failedSamples, 1);
  assert.equal(metrics.recall, 0);
  assert.deepEqual(metrics.regressions, [{
    sampleId: "failed",
    failures: [{ code: "provider.crashed" }, { code: "proposal.false-negative" }],
  }]);

  assert.throws(() => calculateProposalMetrics([{
    sampleId: "bad",
    expected: [{ box: { x: 0, y: 0, width: 0, height: 10 } }],
    ignored: [],
    proposals: [],
    durationMs: 1,
  }], { iouThreshold: 0.5 }), /perception\.metric_box_invalid/u);
});

function sample(sampleId, expectedText, actualText, languageClass, criticalLabel, durationMs, error) {
  return { sampleId, expectedText, actualText, languageClass, criticalLabel, durationMs, error };
}
