import { access, stat } from "node:fs/promises";
import { join } from "node:path";

export const PP_OCRV6_SMALL_MODEL_PACK = {
  id: "ocr-model-pp-ocrv6-small",
  family: "PP-OCRv6",
  variant: "small",
  format: "onnx",
  version: "pinned-by-release",
  acquisition: "bundle-or-approved-install-cache",
  offlineRequired: false,
  files: [
    {
      role: "det",
      path: "PP-OCRv6_det_small.onnx",
      required: true,
      sha256: "pinned-by-release",
    },
    {
      role: "rec",
      path: "PP-OCRv6_rec_small.onnx",
      required: true,
      sha256: "pinned-by-release",
    },
    {
      role: "dictionary",
      path: "ppocrv6_dict.txt",
      required: true,
      sha256: "pinned-by-release",
    },
  ],
};

export function resolveOcrModelPack({ modelRoot, pack = PP_OCRV6_SMALL_MODEL_PACK } = {}) {
  const root = joinPath(modelRoot, "pp-ocrv6-small");
  return {
    ...pack,
    root,
    files: pack.files.map((file) => ({
      ...file,
      path: joinPath(root, file.path),
    })),
  };
}

export async function checkOcrModelPackHealth(options = {}) {
  const probes = {
    pathExists,
    fileSize,
    ...options.probes,
  };
  const resolved = resolveOcrModelPack({
    modelRoot: options.modelRoot,
    pack: options.pack ?? PP_OCRV6_SMALL_MODEL_PACK,
  });
  const files = [];
  for (const file of resolved.files) {
    const exists = await probes.pathExists(file.path);
    const sizeBytes = exists ? await probes.fileSize(file.path) : 0;
    files.push({
      role: file.role,
      path: file.path,
      required: file.required,
      sha256: file.sha256,
      status: exists ? "present" : "missing",
      sizeBytes,
    });
  }
  const missingFiles = files.filter((file) => file.required && file.status !== "present");
  const presentFiles = files.filter((file) => file.status === "present");
  const totalBytes = presentFiles.reduce((sum, file) => sum + file.sizeBytes, 0);

  return {
    status: missingFiles.length === 0 ? "healthy" : "missing",
    id: resolved.id,
    family: resolved.family,
    variant: resolved.variant,
    format: resolved.format,
    version: resolved.version,
    root: resolved.root,
    acquisition: resolved.acquisition,
    offlineRequired: resolved.offlineRequired,
    files,
    presentFiles,
    missingFiles,
    totalBytes,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(targetPath) {
  try {
    return (await stat(targetPath)).size;
  } catch {
    return 0;
  }
}

function joinPath(root, child) {
  if (root.includes("\\")) return `${root}\\${child}`;
  return join(root, child).replace(/\\/g, "/");
}
