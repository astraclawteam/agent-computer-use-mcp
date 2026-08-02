import { createCanvas, loadImage } from "ppu-ocv";

export async function readImagePixels(path) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data: imageData.data,
  };
}

export function detectControlSurfaceFromPixels(image, textBounds, { tolerance = 6 } = {}) {
  if (!isPixelImage(image) || !isBox(textBounds)) return null;
  const centerY = Math.floor(textBounds.y + (textBounds.height / 2));
  const rowCandidates = [...new Set([
    -3, -2, -1, 0,
    textBounds.height - 1,
    textBounds.height, textBounds.height + 1, textBounds.height + 2, textBounds.height + 3,
  ].map((offset) => Math.max(
    0,
    Math.min(image.height - 1, Math.floor(textBounds.y + offset)),
  )))];
  const seedCandidates = [
    Math.max(0, Math.floor(textBounds.x - 6)),
    Math.min(image.width - 1, Math.ceil(textBounds.x + textBounds.width + 6)),
  ];
  const horizontalCandidates = rowCandidates.flatMap((y) => seedCandidates.map((x) => (
    scanHorizontal(image, x, y, tolerance)
  ))).filter((segment) => segment.x <= textBounds.x
    && segment.x + segment.width >= textBounds.x + textBounds.width
    && segment.width <= Math.min(image.width * 0.6, textBounds.width * 12));
  const horizontal = horizontalCandidates.sort((left, right) => left.width - right.width)[0];
  const outline = detectOutlinedSurface(horizontalCandidates, textBounds, image);
  if (outline && (!horizontal || outline.width <= horizontal.width * 1.15)) return outline;
  if (!horizontal) return null;

  const verticalSeeds = [
    Math.max(horizontal.x, Math.floor(textBounds.x - 8)),
    Math.min(horizontal.x + horizontal.width - 1, Math.ceil(textBounds.x + textBounds.width + 8)),
  ];
  const vertical = verticalSeeds.map((x) => scanVertical(image, x, centerY, tolerance))
    .filter((segment) => segment.y <= textBounds.y
      && segment.y + segment.height >= textBounds.y + textBounds.height)
    .sort((left, right) => right.height - left.height)[0];
  if (!vertical) return null;

  const candidate = {
    x: horizontal.x,
    y: vertical.y,
    width: horizontal.width,
    height: vertical.height,
  };
  const horizontalPadding = candidate.width - textBounds.width;
  const verticalPadding = candidate.height - textBounds.height;
  const areaRatio = area(candidate) / area(textBounds);
  if (!contains(candidate, textBounds)
    || horizontalPadding < 8 || verticalPadding < 3
    || candidate.width > Math.min(image.width * 0.6, textBounds.width * 12)
    || candidate.height > Math.min(image.height * 0.5, Math.max(80, textBounds.height * 4))
    || areaRatio > 80) return null;
  return candidate;
}

function detectOutlinedSurface(segments, textBounds, image) {
  const top = segments
    .filter((segment) => segment.y < textBounds.y)
    .sort((left, right) => right.y - left.y || left.width - right.width)[0];
  const bottom = segments
    .filter((segment) => segment.y >= textBounds.y + textBounds.height - 1)
    .sort((left, right) => left.y - right.y || left.width - right.width)[0];
  if (!top || !bottom || bottom.y <= top.y) return null;
  const left = Math.max(top.x, bottom.x);
  const right = Math.min(top.x + top.width, bottom.x + bottom.width);
  const candidate = {
    x: left,
    y: top.y,
    width: right - left,
    height: bottom.y - top.y + 1,
  };
  if (!isBox(candidate) || !contains(candidate, textBounds)) return null;
  const horizontalPadding = candidate.width - textBounds.width;
  const verticalPadding = candidate.height - textBounds.height;
  const areaRatio = area(candidate) / area(textBounds);
  const interiorColor = pixelAt(
    image,
    Math.floor(candidate.x + candidate.width / 2),
    Math.floor(candidate.y + candidate.height / 2),
  );
  if (horizontalPadding < 8 || verticalPadding < 1
    || candidate.width > Math.min(image.width * 0.6, textBounds.width * 12)
    || candidate.height > Math.min(image.height * 0.5, Math.max(80, textBounds.height * 4))
    || horizontalOverlapBySmallerWidth(top, bottom) < 0.8
    || colorDistance(top.color, interiorColor) <= 12
    || colorDistance(bottom.color, interiorColor) <= 12
    || areaRatio > 80) return null;
  return candidate;
}

function horizontalOverlapBySmallerWidth(left, right) {
  const overlap = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  return overlap / Math.min(left.width, right.width);
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
  );
}

function scanHorizontal(image, x, y, tolerance) {
  const color = pixelAt(image, x, y);
  let left = x;
  let right = x;
  while (left > 0 && similarColor(pixelAt(image, left - 1, y), color, tolerance)) left -= 1;
  while (right < image.width - 1 && similarColor(pixelAt(image, right + 1, y), color, tolerance)) right += 1;
  return { x: left, y, width: right - left + 1, color };
}

function scanVertical(image, x, y, tolerance) {
  const color = pixelAt(image, x, y);
  let top = y;
  let bottom = y;
  while (top > 0 && similarColor(pixelAt(image, x, top - 1), color, tolerance)) top -= 1;
  while (bottom < image.height - 1 && similarColor(pixelAt(image, x, bottom + 1), color, tolerance)) bottom += 1;
  return { x, y: top, height: bottom - top + 1 };
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return {
    r: image.data[offset] ?? 0,
    g: image.data[offset + 1] ?? 0,
    b: image.data[offset + 2] ?? 0,
  };
}

function similarColor(left, right, tolerance) {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
  ) <= tolerance;
}

function isPixelImage(value) {
  return value !== null && typeof value === "object"
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && value.data?.length >= value.width * value.height * 4;
}

function isBox(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.x) && value.x >= 0
    && Number.isFinite(value.y) && value.y >= 0
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function area(value) {
  return value.width * value.height;
}
