import assert from "node:assert/strict";
import { test } from "node:test";

import { runPerceptionBenchmark } from "../src/perception-benchmark-runner.mjs";

test("benchmark opens one warm OCR session and executes every sample through providers", async () => {
  const calls = [];
  const events = [];
  let opened = 0;
  let closed = 0;
  const corpus = corpusFixture();
  const report = await runPerceptionBenchmark({
    corpus,
    providers: {
      ocr: {
        async open() {
          opened += 1;
          return {
            identity: { provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small", modelFormat: "onnx" },
            async warmup(requests) { calls.push(["warmup", requests.map((entry) => entry.sampleId)]); },
            async recognize(request) {
              calls.push(["ocr", request]);
              return {
                text: request.sample.annotation.normalizedText,
                identity: { provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small", modelFormat: "onnx" },
                durationMs: 999999,
              };
            },
            async close() { closed += 1; },
          };
        },
      },
      visual: {
        identity: { provider: "som-proposal", model: "local-v1" },
        async run(request) {
          calls.push(["visual", request]);
          return {
            proposals: request.sample.annotation.targets.map((target) => ({
              box: target.box,
              confidence: 0.99,
              guessedAction: false,
            })),
            identity: { provider: "som-proposal", model: "local-v1" },
            durationMs: 999999,
          };
        },
      },
    },
    eventSink: async (event) => events.push(event),
  });

  assert.equal(opened, 1);
  assert.equal(closed, 1);
  assert.equal(calls.filter(([kind]) => kind === "ocr").length, 2);
  assert.equal(calls.filter(([kind]) => kind === "visual").length, 2);
  assert.deepEqual(calls.find(([kind]) => kind === "warmup")[1], ["ocr-1"]);
  assert.equal(events.length, corpus.samples.length);
  assert.equal(events.every((event) => event.includeUserOverlay === false), true);
  assert.equal(calls.flatMap(([, request]) => Array.isArray(request) ? [] : [request])
    .every((request) => request.includeUserOverlay === false), true);
  assert.equal(report.status, "measured");
  assert.equal(report.ocr.characterAccuracy, 1);
  assert.equal(report.proposal.recall, 1);
  assert.equal(report.samples.every((sample) => sample.durationMs < 999999), true);
  assert.equal(report.identities.ocr.modelPack, "pp-ocrv6-small");
  assert.equal(JSON.stringify(report).includes("C:\\private-corpus"), false);
});

test("provider failures remain attached to sample IDs and fail the aggregate", async () => {
  let closed = 0;
  const report = await runPerceptionBenchmark({
    corpus: corpusFixture(),
    providers: {
      ocr: {
        async open() {
          return {
            identity: { provider: "ocr", modelPack: "pack", modelFormat: "onnx" },
            async warmup() {},
            async recognize(request) {
              if (request.sampleId === "ocr-2") throw new Error("provider.crashed: private detail");
              return { text: request.sample.annotation.normalizedText, identity: this.identity };
            },
            async close() { closed += 1; },
          };
        },
      },
      visual: {
        identity: { provider: "som", model: "v1" },
        async run(request) {
          if (request.sampleId === "visual-2") throw new Error("provider.crashed: private detail");
          return { proposals: [], identity: this.identity };
        },
      },
    },
  });

  assert.equal(closed, 1);
  assert.equal(report.status, "failed");
  assert.deepEqual(report.samples.filter((sample) => sample.error).map((sample) => sample.sampleId), ["ocr-2", "visual-2"]);
  assert.equal(report.samples.every((sample) => !sample.error || sample.error === "provider.crashed"), true);
  assert.equal(report.ocr.failedSamples, 1);
  assert.equal(report.proposal.failedSamples, 1);
});

test("visual provider execution is bounded", async () => {
  let active = 0;
  let peak = 0;
  const corpus = corpusFixture();
  corpus.samples = [...corpus.samples, ...Array.from({ length: 6 }, (_, index) => ({
    ...structuredClone(corpus.samples[2]),
    id: `extra-visual-${index}`,
    image: { ...corpus.samples[2].image, target: `extra-${index}.png` },
  }))];
  await runPerceptionBenchmark({
    corpus,
    visualConcurrency: 2,
    providers: {
      ocr: {
        async open() {
          return {
            identity: { provider: "ocr", modelPack: "pack", modelFormat: "onnx" },
            async warmup() {},
            async recognize(request) { return { text: request.sample.annotation.normalizedText, identity: this.identity }; },
            async close() {},
          };
        },
      },
      visual: {
        identity: { provider: "som", model: "v1" },
        async run(request) {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { proposals: request.sample.annotation.targets.map((target) => ({ box: target.box, confidence: 1 })), identity: this.identity };
        },
      },
    },
  });
  assert.equal(peak, 2);
});

function corpusFixture() {
  const text = (id, expected, languageClass) => ({
    id,
    kind: "ocr",
    applicationClass: "dialog",
    dpi: 100,
    theme: "light",
    image: { target: `${id}.png` },
    annotation: { normalizedText: expected, languageClass, criticalLabel: true, region: { x: 0, y: 0, width: 80, height: 30 } },
  });
  const visual = (id) => ({
    id,
    kind: "visual",
    applicationClass: "canvas",
    dpi: 125,
    theme: "dark",
    image: { target: `${id}.png` },
    annotation: {
      surfaceClass: "canvas",
      targets: [{ box: { x: 10, y: 10, width: 20, height: 20 }, role: "button", label: "Apply", actionable: true }],
      ignored: [],
    },
  });
  return {
    status: "verified",
    packId: "test-corpus",
    version: "1",
    tier: "quick",
    samples: [text("ocr-1", "Save", "english"), text("ocr-2", "保存", "chinese"), visual("visual-1"), visual("visual-2")],
    resolveImagePath: (sampleId) => `C:\\private-corpus\\${sampleId}.png`,
  };
}
