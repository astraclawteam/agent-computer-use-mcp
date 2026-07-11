import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { withGatewayOverlayBuildLock } from "../src/gateway-overlay-build-host.mjs";

test("gateway overlay build lock serializes concurrent build and publish operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "overlay-build-lock-"));
  const lockPath = join(root, "build.lock");
  const events = [];
  try {
    const first = withGatewayOverlayBuildLock(async () => {
      events.push("first:start");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
      events.push("first:end");
    }, { lockPath, waitMs: 5, timeoutMs: 1000 });
    const second = withGatewayOverlayBuildLock(async () => {
      events.push("second:start");
      events.push("second:end");
    }, { lockPath, waitMs: 5, timeoutMs: 1000 });
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

