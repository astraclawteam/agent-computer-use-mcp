export const DEFAULT_OCR_PREWARM_BUCKETS = [
  { size: "128x96", crop: { x: 90, y: 170, width: 128, height: 96 } },
  { size: "288x96", crop: { x: 90, y: 170, width: 288, height: 96 } },
  { size: "704x320", crop: { x: 90, y: 100, width: 704, height: 320 } },
];

export function expandRegionToBucket(region, options = {}) {
  const widthStep = options.widthStep ?? 32;
  const heightStep = options.heightStep ?? 16;
  const minWidth = options.minWidth ?? 128;
  const minHeight = options.minHeight ?? 96;
  const imageWidth = Number(region.image?.width ?? options.imageWidth);
  const imageHeight = Number(region.image?.height ?? options.imageHeight);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
    throw new Error("crop_bucket.image_size_required");
  }

  const bucketWidth = Math.min(imageWidth, Math.max(minWidth, roundUp(region.width, widthStep)));
  const bucketHeight = Math.min(imageHeight, Math.max(minHeight, roundUp(region.height, heightStep)));
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const x = clamp(Math.round(centerX - bucketWidth / 2), 0, imageWidth - bucketWidth);
  const y = clamp(Math.round(centerY - bucketHeight / 2), 0, imageHeight - bucketHeight);

  return {
    x,
    y,
    width: bucketWidth,
    height: bucketHeight,
    bucket: {
      width: bucketWidth,
      height: bucketHeight,
      widthStep,
      heightStep,
    },
  };
}

function roundUp(value, step) {
  return Math.ceil(value / step) * step;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
