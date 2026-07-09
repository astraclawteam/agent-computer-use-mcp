import assert from "node:assert/strict";
import { test } from "node:test";
import { expandRegionToBucket } from "../src/crop-bucket.mjs";

test("expandRegionToBucket rounds dirty regions into stable OCR buckets", () => {
  const region = expandRegionToBucket({
    x: 8,
    y: 197,
    width: 260,
    height: 85,
    image: { width: 720, height: 420 },
  });

  assert.deepEqual(region, {
    x: 0,
    y: 192,
    width: 288,
    height: 96,
    bucket: {
      width: 288,
      height: 96,
      widthStep: 32,
      heightStep: 16,
    },
  });
});

test("expandRegionToBucket clamps buckets at the lower right image edge", () => {
  const region = expandRegionToBucket({
    x: 650,
    y: 370,
    width: 45,
    height: 32,
    image: { width: 720, height: 420 },
  });

  assert.deepEqual(region, {
    x: 592,
    y: 324,
    width: 128,
    height: 96,
    bucket: {
      width: 128,
      height: 96,
      widthStep: 32,
      heightStep: 16,
    },
  });
});
