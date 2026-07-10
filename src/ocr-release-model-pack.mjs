import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

const OUTPUT_FILES = Object.freeze([
  ["det", "PP-OCRv6_det_small.onnx"],
  ["rec", "PP-OCRv6_rec_small.onnx"],
  ["dictionary", "ppocrv6_dict.txt"],
]);

export async function buildPpOcrV6SmallPack(options = {}) {
  const outputRoot = resolve(required(options.outputRoot, "release.ocr_output_root_missing"));
  const detPath = resolve(required(options.detPath, "release.ocr_det_missing"));
  const recPath = resolve(required(options.recPath, "release.ocr_rec_missing"));
  const metadataPath = resolve(required(options.metadataPath, "release.ocr_metadata_missing"));
  await verifyIdentity(detPath, options.expected?.det);
  await verifyIdentity(recPath, options.expected?.rec);

  let metadata;
  try {
    metadata = parse(await readFile(metadataPath, "utf8"));
  } catch (cause) {
    throw releaseError("release.ocr_metadata_invalid", cause instanceof Error ? cause.message : String(cause));
  }
  const postProcess = metadata?.PostProcess;
  if (postProcess?.name !== "CTCLabelDecode"
    || !Array.isArray(postProcess.character_dict)
    || postProcess.character_dict.length === 0
    || postProcess.character_dict.some((entry) => typeof entry !== "string" || entry === "")) {
    throw releaseError("release.ocr_metadata_invalid", "Official recognition metadata has no CTC character dictionary");
  }

  // The model emits blank + metadata characters + space. The ppu decoder prepends blank.
  const dictionaryEntries = [...postProcess.character_dict, " "];
  const dictionaryBytes = Buffer.from(dictionaryEntries.join("\n"), "utf8");
  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(stageRoot, { recursive: true });
    await copyFile(detPath, join(stageRoot, OUTPUT_FILES[0][1]));
    await copyFile(recPath, join(stageRoot, OUTPUT_FILES[1][1]));
    await writeFile(join(stageRoot, OUTPUT_FILES[2][1]), dictionaryBytes);

    const files = [];
    for (const [role, name] of OUTPUT_FILES) {
      const path = join(stageRoot, name);
      const bytes = await readFile(path);
      files.push({
        role,
        name,
        path: join(outputRoot, name),
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(dirname(outputRoot), { recursive: true });
    await rename(stageRoot, outputRoot);
    return {
      status: "ready",
      id: "ocr-model-pp-ocrv6-small",
      version: "pp-ocrv6-small-2026-06",
      family: "PP-OCRv6",
      variant: "small",
      modelFormat: "onnx",
      root: outputRoot,
      sourceDictionaryEntries: postProcess.character_dict.length,
      dictionaryEntries: dictionaryEntries.length,
      files,
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

async function verifyIdentity(path, expected) {
  if (!expected || !Number.isSafeInteger(expected.sizeBytes) || !/^[a-f0-9]{64}$/.test(expected.sha256 ?? "")) {
    throw releaseError("release.ocr_model_identity_mismatch", "Expected OCR model identity is missing");
  }
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size !== expected.sizeBytes) {
    throw releaseError("release.ocr_model_identity_mismatch", "OCR model size does not match lock");
  }
  if (sha256(await readFile(path)) !== expected.sha256) {
    throw releaseError("release.ocr_model_identity_mismatch", "OCR model hash does not match lock");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw releaseError(code, code);
  return value;
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
