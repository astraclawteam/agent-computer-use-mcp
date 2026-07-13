import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createCanvas, loadImage } from "ppu-ocv";

export class PerceptionRegionCache {
  constructor(options = {}) {
    this.maxEntries = positiveInteger(options.maxEntries ?? 256, "perception.cache_max_entries_invalid");
    this.maxBytes = positiveInteger(options.maxBytes ?? 64 * 1024 * 1024, "perception.cache_max_bytes_invalid");
    this.ttlMs = positiveInteger(options.ttlMs ?? 5000, "perception.cache_ttl_invalid");
    this.now = options.now ?? (() => Date.now());
    this.entries = new Map();
    this.totalBytes = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, metadata = {}) {
    if (metadata.sensitive === true || metadata.providerError === true) return false;
    if (typeof metadata.windowId !== "string" || metadata.windowId.trim() === "") throw cacheError("perception.cache_window_required");
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > this.maxBytes) return false;
    this.delete(key);
    this.entries.set(key, {
      value,
      windowId: metadata.windowId,
      bytes,
      expiresAt: this.now() + this.ttlMs,
    });
    this.totalBytes += bytes;
    this.evictToBounds();
    return this.entries.has(key);
  }

  invalidateWindow(windowId) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.windowId !== windowId) continue;
      this.delete(key);
      removed += 1;
    }
    return removed;
  }

  delete(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
    return true;
  }

  evictToBounds() {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}

export function createPerceptionRegionCacheKey(options = {}) {
  if (options.includeUserOverlay !== false) throw cacheError("perception.cache_overlay_forbidden");
  const windowId = requiredString(options.windowId, "perception.cache_window_required");
  const region = normalizeRegion(options.region);
  const pixels = Buffer.isBuffer(options.pixels) ? options.pixels : Buffer.from(options.pixels ?? []);
  if (pixels.length === 0) throw cacheError("perception.cache_pixels_required");
  const modelIdentity = normalizeIdentity(options.modelIdentity);
  const normalizationVersion = requiredString(options.normalizationVersion, "perception.cache_normalization_required");
  const pixelSha256 = createHash("sha256").update(pixels).digest("hex");
  const descriptor = JSON.stringify({ windowId, region, pixelSha256, modelIdentity, normalizationVersion });
  return `perception-region:v1:${createHash("sha256").update(descriptor).digest("hex")}`;
}

export async function readOverlayFreeRegionPixels(imagePath, region = null) {
  if (!region) return readFile(imagePath);
  const crop = normalizeRegion(region);
  const image = await loadImage(imagePath);
  if (crop.x + crop.width > image.width || crop.y + crop.height > image.height) throw cacheError("perception.cache_region_out_of_bounds");
  const canvas = createCanvas(crop.width, crop.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas.toBuffer("image/png");
}

function normalizeIdentity(identity) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) throw cacheError("perception.cache_model_identity_invalid");
  const output = {};
  for (const key of ["provider", "model", "modelPack", "modelFormat", "runtime", "executionProvider"]) {
    if (typeof identity[key] === "string" && identity[key].trim() !== "") output[key] = identity[key];
  }
  if (!output.provider) throw cacheError("perception.cache_model_identity_invalid");
  return output;
}

function normalizeRegion(region) {
  if (region === null || typeof region !== "object" || Array.isArray(region)
    || !Number.isSafeInteger(region.x) || region.x < 0
    || !Number.isSafeInteger(region.y) || region.y < 0
    || !Number.isSafeInteger(region.width) || region.width <= 0
    || !Number.isSafeInteger(region.height) || region.height <= 0) {
    throw cacheError("perception.cache_region_invalid");
  }
  return { x: region.x, y: region.y, width: region.width, height: region.height };
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) throw cacheError(code);
  return value;
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw cacheError(code);
  return value;
}

function cacheError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
