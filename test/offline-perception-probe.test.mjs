import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";
import { createReleasedPerceptionProviders, runOfflinePerceptionProbe } from "../src/offline-perception-probe.mjs";

test("offline perception probe initializes the bundled ONNX pack and prewarms OCR", async () => {
  const calls = [];
  const result = await runOfflinePerceptionProbe({
    async callTool(request) {
      calls.push(request);
      return {
        isError: false,
        structuredContent: {
          status: "ready",
          ocr: {
            status: "healthy",
            modelFormat: "onnx",
            networkDisabled: true,
          },
          prewarm: { status: "completed", buckets: [{ count: 4 }] },
        },
      };
    },
  }, { timeout: 30_000, maxTotalTimeout: 30_000 });

  assert.deepEqual(calls, [{
    name: "computer.health",
    arguments: { fast: false, prewarm: true },
  }]);
  assert.equal(result.ocrInitialized, true);
  assert.equal(result.networkDisabled, true);
  assert.equal(result.prewarmCompleted, true);
});

test("offline perception probe rejects default or network-capable OCR", async () => {
  await assert.rejects(
    runOfflinePerceptionProbe({
      async callTool() {
        return {
          isError: false,
          structuredContent: {
            status: "ready",
            ocr: { status: "healthy", modelFormat: "ort-default", networkDisabled: false },
            prewarm: { status: "completed" },
          },
        };
      },
    }, {}),
    /release\.offline_ocr_not_verified/u,
  );
});

test("released OCR benchmark provider keeps one verified offline ONNX session", async () => {
  const requests = [];
  let starts = 0;
  let closes = 0;
  const providers = createReleasedPerceptionProviders({
    ocrSessionFactory: () => ({
      async start() { starts += 1; },
      async doctor() { return identity({ status: "healthy", networkDisabled: true }); },
      async recognize(request) {
        requests.push(request);
        return identity({ items: [{ text: "Save" }] });
      },
      async close() { closes += 1; },
    }),
  });
  const session = await providers.ocr.open();
  const request = {
    sampleId: "ocr-save",
    imagePath: "C:\\corpus\\save.png",
    includeUserOverlay: false,
    sample: { annotation: { region: { x: 0, y: 0, width: 80, height: 32 }, languageClass: "english" } },
  };
  await session.warmup([request]);
  const result = await session.recognize(request);
  await session.close();

  assert.equal(starts, 1);
  assert.equal(closes, 1);
  assert.equal(result.text, "Save");
  assert.equal(result.identity.modelFormat, "onnx");
  assert.equal(requests.length, 2);
  assert.equal(requests.every((entry) => entry.noCache === true && entry.languages[0] === "en"), true);
  assert.equal(requests.every((entry) => !Object.hasOwn(entry, "includeUserOverlay")), true);
});

test("released visual benchmark provider fuses local SOM with the active OCR session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "acu-released-visual-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = await generateQuickCorpus({ outputRoot: root, seed: 20260713 });
  const sample = manifest.samples.find((entry) => entry.kind === "visual" && entry.annotation.surfaceClass === "canvas");
  const target = sample.annotation.targets[0].box;
  const providers = createReleasedPerceptionProviders({
    somMinConfidence: 0.55,
    ocrSessionFactory: () => ({
      async start() {},
      async doctor() { return identity({ status: "healthy", networkDisabled: true }); },
      async recognize() {
        return identity({
          items: [{
            text: sample.annotation.targets[0].label,
            bounds: { x: target.x - 4, y: target.y - 4, width: target.width + 8, height: target.height + 8 },
            confidence: 0.999,
          }],
        });
      },
      async close() {},
    }),
  });
  const ocr = await providers.ocr.open();
  const result = await providers.visual.run({
    sampleId: sample.id,
    sample,
    imagePath: join(root, ...sample.image.target.split("/")),
    includeUserOverlay: false,
  });
  await ocr.close();

  assert.equal(result.identity.provider, "local-proposal-fusion");
  assert.equal(result.proposals.length, 1);
  assert.deepEqual(result.proposals[0].support.map((entry) => entry.provider), ["ocr", "som-proposal"]);
  assert.equal(result.proposals.every((proposal) => proposal.guessedAction === false), true);
});

function identity(overrides = {}) {
  return {
    provider: "xiaozhiclaw-ocr-sidecar",
    modelPack: "pp-ocrv6-small",
    modelFormat: "onnx",
    runtime: "onnxruntime-cpu",
    executionProvider: "CPUExecutionProvider",
    ...overrides,
  };
}
