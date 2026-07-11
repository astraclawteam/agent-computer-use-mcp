import assert from "node:assert/strict";
import { test } from "node:test";

import { runOfflinePerceptionProbe } from "../src/offline-perception-probe.mjs";

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
