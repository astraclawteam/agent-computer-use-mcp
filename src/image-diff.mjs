import { createCanvas, loadImage } from "ppu-ocv";

export async function computeDirtyRegion(beforePath, afterPath, options = {}) {
  const threshold = options.threshold ?? 18;
  const padding = options.padding ?? 24;
  const before = await loadPngPixels(beforePath);
  const after = await loadPngPixels(afterPath);

  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`image.size_mismatch: before=${before.width}x${before.height} after=${after.width}x${after.height}`);
  }

  let minX = before.width;
  let minY = before.height;
  let maxX = -1;
  let maxY = -1;
  let changedPixels = 0;

  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = (y * before.width + x) * 4;
      const delta = Math.max(
        Math.abs(before.data[offset] - after.data[offset]),
        Math.abs(before.data[offset + 1] - after.data[offset + 1]),
        Math.abs(before.data[offset + 2] - after.data[offset + 2]),
        Math.abs(before.data[offset + 3] - after.data[offset + 3]),
      );
      if (delta <= threshold) continue;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (changedPixels === 0) {
    return null;
  }

  const x = clamp(minX - padding, 0, before.width - 1);
  const y = clamp(minY - padding, 0, before.height - 1);
  const right = clamp(maxX + padding, 0, before.width - 1);
  const bottom = clamp(maxY + padding, 0, before.height - 1);

  return {
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
    changedPixels,
    image: { width: before.width, height: before.height },
  };
}

async function loadPngPixels(path) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data: imageData.data,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
