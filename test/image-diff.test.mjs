import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCanvas } from "ppu-ocv";
import { computeDirtyRegion } from "../src/image-diff.mjs";

test("computeDirtyRegion returns a padded bounding box around changed pixels", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-diff-test-"));
  const beforePath = join(dir, "before.png");
  const afterPath = join(dir, "after.png");

  await writeFile(beforePath, makeImage(false));
  await writeFile(afterPath, makeImage(true));

  const dirty = await computeDirtyRegion(beforePath, afterPath, { threshold: 10, padding: 3 });

  assert.deepEqual(dirty, {
    x: 7,
    y: 9,
    width: 16,
    height: 18,
    changedPixels: 120,
    image: { width: 40, height: 32 },
  });
});

function makeImage(changed) {
  const canvas = createCanvas(40, 32);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 40, 32);
  if (changed) {
    ctx.fillStyle = "black";
    ctx.fillRect(10, 12, 10, 12);
  }
  return canvas.toBuffer("image/png");
}
