import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FORBIDDEN_PNG_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]);
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 4096;

const PRIVATE_STRING_PATTERNS = Object.freeze([
  ["private-path", /(?:[A-Za-z]:\\Users\\|\/(?:home|Users)\/)/iu],
  ["contact", /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?<!\d)1[3-9]\d{9}(?!\d))/iu],
  ["credential", /(?:\b(?:password|passwd|api[_ -]?key|access[_ -]?token|secret)\b|密码|口令)/iu],
  ["payment", /(?:credit\s*card|\bcvv\b|银行卡|支付密码|卡号)/iu],
  ["recent-file", /(?:recent(?:\s+files?)?|\bMRU\b|最近(?:文件|项目|打开))/iu],
  ["location-or-network", /(?:\b(?:GPS|latitude|longitude|host(?:name)?)\s*[:= ]|\b(?:\d{1,3}\.){3}\d{1,3}\b)/iu],
]);

export async function scanCorpusPrivacy({ manifest, root } = {}) {
  if (!isRecord(manifest) || !Array.isArray(manifest.samples) || !Array.isArray(manifest.licenses)) {
    throw privacyError("perception.privacy_manifest_invalid");
  }
  if (typeof root !== "string" || root.trim() === "") throw privacyError("perception.privacy_root_required");
  const violations = [];
  const licenses = new Set(manifest.licenses.map((license) => license?.id).filter(Boolean));

  scanStrings(manifest, (category, location) => addViolation(violations, category, sampleIdFromLocation(location)));
  for (const sample of manifest.samples) {
    if (!licenses.has(sample.licenseId)) addViolation(violations, "license", sample.id);
    const path = sample.image?.target;
    if (typeof path !== "string" || path.includes("\\") || path.split("/").includes("..")) {
      addViolation(violations, "private-path", sample.id);
      continue;
    }
    const bytes = await readFile(join(root, ...path.split("/"))).catch(() => null);
    if (!bytes) {
      addViolation(violations, "png-invalid", sample.id);
      continue;
    }
    let png;
    try {
      png = inspectPng(bytes);
    } catch {
      addViolation(violations, "png-invalid", sample.id);
      continue;
    }
    if (png.forbiddenMetadata) addViolation(violations, "png-metadata", sample.id);
    if (png.width >= 1280 && png.height >= 720) addViolation(violations, "full-desktop", sample.id);
    if (!sampleAnnotationsFit(sample, png)) addViolation(violations, "bounds", sample.id);
  }

  return Object.freeze({
    status: violations.length === 0 ? "passed" : "rejected",
    scannedSamples: manifest.samples.length,
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
  });
}

function inspectPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > MAX_PNG_BYTES
    || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw privacyError("perception.privacy_png_invalid");
  }
  let offset = 8;
  let chunks = 0;
  let width;
  let height;
  let forbiddenMetadata = false;
  let ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || chunks >= MAX_CHUNKS) throw privacyError("perception.privacy_png_invalid");
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_CHUNK_BYTES || offset + 12 + length > bytes.length) {
      throw privacyError("perception.privacy_png_invalid");
    }
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw privacyError("perception.privacy_png_invalid");
    if (chunks === 0) {
      if (type !== "IHDR" || length !== 13) throw privacyError("perception.privacy_png_invalid");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      if (width <= 0 || height <= 0) throw privacyError("perception.privacy_png_invalid");
    }
    if (FORBIDDEN_PNG_CHUNKS.has(type)) forbiddenMetadata = true;
    offset += 12 + length;
    chunks += 1;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length) throw privacyError("perception.privacy_png_invalid");
      ended = true;
      break;
    }
  }
  if (!ended || !width || !height) throw privacyError("perception.privacy_png_invalid");
  return { width, height, forbiddenMetadata };
}

function sampleAnnotationsFit(sample, image) {
  if (sample.kind === "ocr") return boxFits(sample.annotation?.region, image);
  if (sample.kind !== "visual") return false;
  const targets = sample.annotation?.targets;
  const ignored = sample.annotation?.ignored;
  return Array.isArray(targets) && Array.isArray(ignored)
    && [...targets, ...ignored].every((entry) => boxFits(entry?.box, image));
}

function boxFits(box, image) {
  return isRecord(box)
    && Number.isFinite(box.x) && Number.isFinite(box.y)
    && Number.isFinite(box.width) && Number.isFinite(box.height)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= image.width
    && box.y + box.height <= image.height;
}

function scanStrings(value, onMatch, location = []) {
  if (typeof value === "string") {
    for (const [category, pattern] of PRIVATE_STRING_PATTERNS) {
      if (pattern.test(value)) onMatch(category, location);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanStrings(entry, onMatch, [...location, index]));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) scanStrings(entry, onMatch, [...location, key]);
  }
}

function sampleIdFromLocation(location) {
  const samplesIndex = location.indexOf("samples");
  if (samplesIndex === -1 || !Number.isSafeInteger(location[samplesIndex + 1])) return "manifest";
  return `sample-index-${location[samplesIndex + 1]}`;
}

function addViolation(violations, category, sampleId) {
  if (!violations.some((entry) => entry.category === category && entry.sampleId === sampleId)) {
    violations.push({ category, sampleId: typeof sampleId === "string" ? sampleId : "unknown" });
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function privacyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
