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
  let active = 0;
  let maxActive = 0;
  try {
    const first = withGatewayOverlayBuildLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("first:start");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
      events.push("first:end");
      active -= 1;
    }, { lockPath, waitMs: 5, timeoutMs: 1000 });
    const second = withGatewayOverlayBuildLock(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push("second:start");
      events.push("second:end");
      active -= 1;
    }, { lockPath, waitMs: 5, timeoutMs: 1000 });
    await Promise.all([first, second]);
    assert.equal(maxActive, 1);
    assert.ok(events.indexOf("first:start") < events.indexOf("first:end"));
    assert.ok(events.indexOf("second:start") < events.indexOf("second:end"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
