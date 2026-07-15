import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import { ComputerUseProviderRouter } from "../src/computer-use-provider-router.mjs";
import {
  PerceptionRegionCache,
  createPerceptionRegionCacheKey,
} from "../src/perception-region-cache.mjs";

const MODEL = Object.freeze({ provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small", modelFormat: "onnx" });
const REGION = Object.freeze({ x: 1, y: 2, width: 20, height: 10 });

test("cache keys are content-addressed and preserve provider provenance", () => {
  const cache = new PerceptionRegionCache({ maxEntries: 4, maxBytes: 4096, ttlMs: 5000, now: () => 100 });
  const key = keyFor(Buffer.from("pixels-a"));
  const changed = keyFor(Buffer.from("pixels-b"));
  const value = { text: "Save", identity: MODEL };

  cache.set(key, value, { windowId: "window-1" });

  assert.deepEqual(cache.get(key), value);
  assert.equal(cache.get(changed), null);
  assert.deepEqual(cache.get(key).identity, MODEL);
});

test("window invalidation is scoped and overlay observations cannot form keys", () => {
  const cache = new PerceptionRegionCache({ maxEntries: 4, maxBytes: 4096, ttlMs: 5000 });
  const first = keyFor(Buffer.from("same"), "window-1");
  const second = keyFor(Buffer.from("same"), "window-2");
  cache.set(first, { id: 1 }, { windowId: "window-1" });
  cache.set(second, { id: 2 }, { windowId: "window-2" });

  assert.equal(cache.invalidateWindow("window-1"), 1);
  assert.equal(cache.get(first), null);
  assert.deepEqual(cache.get(second), { id: 2 });
  assert.throws(() => keyFor(Buffer.from("pixels"), "window-1", true), /perception\.cache_overlay_forbidden/u);
});

test("cache enforces TTL LRU entry and byte bounds", () => {
  let now = 0;
  const cache = new PerceptionRegionCache({ maxEntries: 2, maxBytes: 80, ttlMs: 10, now: () => now });
  const first = keyFor(Buffer.from("a"));
  const second = keyFor(Buffer.from("b"));
  const third = keyFor(Buffer.from("c"));
  cache.set(first, { value: "1" }, { windowId: "window-1" });
  cache.set(second, { value: "2" }, { windowId: "window-1" });
  cache.get(first);
  cache.set(third, { value: "3" }, { windowId: "window-1" });

  assert.equal(cache.get(second), null);
  assert.deepEqual(cache.get(first), { value: "1" });
  now = 11;
  assert.equal(cache.get(first), null);
  assert.equal(cache.get(third), null);

  const bounded = new PerceptionRegionCache({ maxEntries: 5, maxBytes: 20, ttlMs: 100 });
  bounded.set(first, { value: "larger-than-budget" }, { windowId: "window-1" });
  assert.equal(bounded.get(first), null);
});

test("sensitive regions and provider errors are never cached", () => {
  const cache = new PerceptionRegionCache({ maxEntries: 4, maxBytes: 4096, ttlMs: 5000 });
  const sensitive = keyFor(Buffer.from("sensitive"));
  const failed = keyFor(Buffer.from("failed"));

  assert.equal(cache.set(sensitive, { text: "secret" }, { windowId: "window-1", sensitive: true }), false);
  assert.equal(cache.set(failed, { error: "provider.failed" }, { windowId: "window-1", providerError: true }), false);
  assert.equal(cache.get(sensitive), null);
  assert.equal(cache.get(failed), null);
});

test("provider router reuses OCR only for identical overlay-free region pixels", async (t) => {
  let recognizeCalls = 0;
  const ocr = {
    async start() {},
    async recognize() {
      recognizeCalls += 1;
      return {
        ...MODEL,
        items: [{ text: "Apply", bounds: REGION, confidence: 0.99 }],
        timings: { totalMs: 10 },
      };
    },
    async close() {},
  };
  const router = new ComputerUseProviderRouter({ ocrSession: ocr });
  t.after(() => router.close());
  const imagePath = resolve("test/fixtures/perception/regressions/images/quick-visual-canvas.png");

  const first = await router.ocrRegion({ imagePath, crop: REGION, windowId: "fixture-window" });
  const second = await router.ocrRegion({ imagePath, crop: REGION, windowId: "fixture-window" });

  assert.equal(recognizeCalls, 1);
  assert.equal(first.observation.cacheHit, false);
  assert.equal(second.observation.cacheHit, true);
  assert.deepEqual(await readFile(imagePath), await readFile(imagePath));
});

function keyFor(pixels, windowId = "window-1", includeUserOverlay = false) {
  return createPerceptionRegionCacheKey({
    windowId,
    region: REGION,
    pixels,
    modelIdentity: MODEL,
    normalizationVersion: "ui-text-v1",
    includeUserOverlay,
  });
}
