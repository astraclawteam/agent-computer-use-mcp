import { expandRegionToBucket } from "./crop-bucket.mjs";
import { PP_OCRV6_SMALL_MODEL_PACK } from "./ocr-model-pack.mjs";

export function scheduleOcrRegion(options = {}) {
  const mode = options.mode ?? "action-loop";
  const modelPackId = options.modelPackId ?? PP_OCRV6_SMALL_MODEL_PACK.id;
  const windowRef = normalizeWindow(options.window);
  const image = normalizeImage(options.dirtyRegion?.image ?? options.regionHint?.image ?? options.image);

  if (options.dirtyRegion || options.regionHint) {
    const sourceRegion = options.dirtyRegion ?? options.regionHint;
    const bucketedRegion = expandRegionToBucket({
      ...sourceRegion,
      image,
    });
    const request = buildRequest({
      imagePath: options.imagePath,
      crop: bucketedRegion,
      languages: options.languages,
      timeoutMs: options.timeoutMs,
    });
    const plan = {
      status: "scheduled",
      mode,
      strategy: options.dirtyRegion ? "dirty-region-ocr" : "region-hint-ocr",
      reason: options.dirtyRegion ? "dirty-region-detected" : "region-hint-provided",
      modelPackId,
      window: windowRef,
      image,
      sourceRegion,
      request,
      fullWindowOcr: false,
      cache: {
        policy: "region-bucket",
        key: null,
        contentAddressed: true,
        ttlMs: options.cacheTtlMs ?? 5000,
      },
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
    return plan;
  }

  if (mode === "diagnostic" && options.allowFullWindow === true) {
    return {
      status: "scheduled",
      mode,
      strategy: "diagnostic-full-window-ocr",
      reason: "explicit-diagnostic-full-window",
      modelPackId,
      window: windowRef,
      image,
      request: buildRequest({
        imagePath: options.imagePath,
        crop: null,
        languages: options.languages,
        timeoutMs: options.timeoutMs,
      }),
      fullWindowOcr: true,
      cache: {
        policy: "diagnostic-no-action-loop",
        key: null,
        ttlMs: 0,
      },
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  return {
    status: "skipped",
    mode,
    strategy: "none",
    reason: "full-window-ocr-disabled-in-action-loop",
    modelPackId,
    window: windowRef,
    image,
    request: null,
    fullWindowOcr: false,
    cache: {
      policy: "no-region-no-cache",
      key: null,
      ttlMs: 0,
    },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function buildOcrRegionCacheKey(plan, pixelSha256) {
  if (typeof pixelSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(pixelSha256)) {
    throw new Error("ocr_region_scheduler.pixel_sha256_required");
  }
  const modelPackId = plan.modelPackId ?? PP_OCRV6_SMALL_MODEL_PACK.id;
  const windowId = plan.window?.id ?? "unknown-window";
  const image = normalizeImage(plan.image);
  const crop = plan.request?.crop;
  if (!crop) return null;
  return [
    "ocr-region",
    "v2",
    modelPackId,
    windowId,
    `${image.width}x${image.height}`,
    `${crop.x},${crop.y},${crop.width},${crop.height}`,
    pixelSha256,
  ].join(":");
}

function buildRequest({ imagePath, crop, languages, timeoutMs }) {
  return {
    imagePath,
    crop: crop ? pickCrop(crop) : null,
    languages: languages ?? ["zh", "en"],
    timeoutMs: timeoutMs ?? 15000,
    noCache: false,
  };
}

function normalizeWindow(window = {}) {
  return {
    id: String(window.id ?? window.windowId ?? window.window_id ?? "unknown-window"),
    title: String(window.title ?? ""),
  };
}

function normalizeImage(image = {}) {
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("ocr_region_scheduler.image_size_required");
  }
  return { width, height };
}

function pickCrop(region) {
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  };
}
