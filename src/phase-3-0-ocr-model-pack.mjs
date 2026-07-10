import { checkOcrModelPackHealth, PP_OCRV6_SMALL_MODEL_PACK } from "./ocr-model-pack.mjs";
import { getInstallLayout } from "./package-foundation.mjs";

const layout = getInstallLayout();

try {
  const health = await checkOcrModelPackHealth({
    modelRoot: layout.modelRoot,
  });
  const requiredRoles = PP_OCRV6_SMALL_MODEL_PACK.files
    .filter((file) => file.required)
    .map((file) => file.role);
  const passed = PP_OCRV6_SMALL_MODEL_PACK.id === "ocr-model-pp-ocrv6-small"
    && PP_OCRV6_SMALL_MODEL_PACK.format === "onnx"
    && requiredRoles.join(",") === "det,rec,dictionary"
    && health.startsDesktopControl === false
    && health.includeUserOverlay === false;

  process.stdout.write(`${JSON.stringify({
    status: passed ? "passed" : "failed",
    phase: "3.0",
    benchmark: "ocr-model-pack-manager",
    modelPackId: PP_OCRV6_SMALL_MODEL_PACK.id,
    family: PP_OCRV6_SMALL_MODEL_PACK.family,
    variant: PP_OCRV6_SMALL_MODEL_PACK.variant,
    format: PP_OCRV6_SMALL_MODEL_PACK.format,
    requiredRoles,
    modelRoot: layout.modelRoot,
    healthStatus: health.status,
    missingRoles: health.missingFiles.map((file) => file.role),
    planOnly: true,
    includeUserOverlay: false,
    startsDesktopControl: false,
  }, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    phase: "3.0",
    benchmark: "ocr-model-pack-manager",
    error: error instanceof Error ? error.message : String(error),
    includeUserOverlay: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
