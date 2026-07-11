import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WINDOWS_X64_OFFLINE_MAX_BYTES,
  assertOfflineBundleSize,
} from "../src/release-size-policy.mjs";
import { WINDOWS_X64_RELEASE_TARGET } from "../src/release-target.mjs";

test("Windows x64 offline bundle accepts the exact commercial size limit", () => {
  assert.equal(WINDOWS_X64_OFFLINE_MAX_BYTES, 310 * 1024 * 1024);
  assert.deepEqual(assertOfflineBundleSize({
    target: WINDOWS_X64_RELEASE_TARGET,
    sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
  }), {
    sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
    maxBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
  });
});

test("Windows x64 offline bundle rejects one byte over the limit", () => {
  assert.throws(
    () => assertOfflineBundleSize({
      target: WINDOWS_X64_RELEASE_TARGET,
      sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES + 1,
    }),
    (error) => error?.code === "release.offline_bundle_too_large",
  );
});

test("offline bundle size must be a non-negative safe integer", () => {
  for (const sizeBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.throws(
      () => assertOfflineBundleSize({ target: WINDOWS_X64_RELEASE_TARGET, sizeBytes }),
      (error) => error?.code === "release.offline_bundle_size_invalid",
    );
  }
});
