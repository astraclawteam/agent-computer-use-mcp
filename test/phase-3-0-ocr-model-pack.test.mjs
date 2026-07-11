import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("OCR model pack manifest declares PP-OCRv6 small ONNX files", async () => {
  const {
    PP_OCRV6_SMALL_MODEL_PACK,
    resolveOcrModelPack,
  } = await import("../src/ocr-model-pack.mjs");

  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.id, "ocr-model-pp-ocrv6-small");
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.family, "PP-OCRv6");
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.variant, "small");
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.format, "onnx");
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.files.length, 3);
  assert.deepEqual(PP_OCRV6_SMALL_MODEL_PACK.files.map((file) => file.role), ["det", "rec", "dictionary"]);
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.version, "pp-ocrv6-small-2026-06");
  assert.deepEqual(PP_OCRV6_SMALL_MODEL_PACK.files.map(({ role, sizeBytes, sha256 }) => ({ role, sizeBytes, sha256 })), [
    { role: "det", sizeBytes: 9880512, sha256: "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e" },
    { role: "rec", sizeBytes: 21159378, sha256: "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634" },
    { role: "dictionary", sizeBytes: 74948, sha256: "03dfb9f1cf3043c41cd037f7ecdae8641e82242f789f0739c899e8d666a1f0db" },
  ]);
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.acquisition, "bundle-or-approved-install-cache");
  assert.equal(PP_OCRV6_SMALL_MODEL_PACK.offlineRequired, false);

  const resolved = resolveOcrModelPack({
    modelRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models",
  });
  assert.equal(resolved.root, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small");
  assert.deepEqual(resolved.files.map((file) => file.path), [
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\PP-OCRv6_det_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\PP-OCRv6_rec_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models\\pp-ocrv6-small\\ppocrv6_dict.txt",
  ]);
});

test("OCR model pack doctor reports missing required model files", async () => {
  const {
    checkOcrModelPackHealth,
    resolveOcrModelPack,
  } = await import("../src/ocr-model-pack.mjs");
  const resolved = resolveOcrModelPack({
    modelRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models",
  });
  const existing = new Set([
    resolved.files.find((file) => file.role === "det").path,
  ]);

  const health = await checkOcrModelPackHealth({
    modelRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\models",
    probes: {
      pathExists: async (path) => existing.has(path),
      fileSize: async () => 1024,
    },
  });

  assert.equal(health.status, "missing");
  assert.equal(health.id, "ocr-model-pp-ocrv6-small");
  assert.deepEqual(health.presentFiles.map((file) => file.role), ["det"]);
  assert.deepEqual(health.missingFiles.map((file) => file.role), ["rec", "dictionary"]);
  assert.equal(health.includeUserOverlay, false);
  assert.equal(health.startsDesktopControl, false);
});

test("install cache doctor uses OCR model pack file-level health", async () => {
  const { runInstallCacheDoctor } = await import("../src/install-cache-doctor.mjs");
  const present = new Set([
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\cache\\models\\pp-ocrv6-small\\PP-OCRv6_det_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\cache\\models\\pp-ocrv6-small\\PP-OCRv6_rec_small.onnx",
    "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\cache\\models\\pp-ocrv6-small\\ppocrv6_dict.txt",
  ]);
  const doctor = await runInstallCacheDoctor({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
    probes: {
      pathExists: async (path) => present.has(path) || !path.includes("pp-ocrv6-small"),
      fileSize: async () => 4096,
      driverHealth: async () => ({ status: "healthy", version: "cua-driver 1.2.3" }),
      webView2Health: async () => ({ status: "healthy", version: "123.0.0" }),
      ocrRuntimeHealth: async () => ({ status: "healthy", runtime: "onnxruntime-node" }),
      permissionsHealth: async () => ({ status: "healthy" }),
      signatureHealth: async () => ({ status: "healthy" }),
    },
  });

  const modelAsset = doctor.assets.find((asset) => asset.id === "ocr-model-pp-ocrv6-small");
  assert.equal(modelAsset.status, "healthy");
  assert.equal(modelAsset.health.status, "healthy");
  assert.equal(modelAsset.health.files.length, 3);
  assert.equal(modelAsset.health.totalBytes, 12288);
  assert.deepEqual(doctor.repairPlan.actions, []);
});

test("Phase 3.0 has an executable OCR model pack manager smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.0"], "node src/phase-3-0-ocr-model-pack.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.0"], "ocr-model-pack-manager");

  const result = await runNode(["src/phase-3-0-ocr-model-pack.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.0");
  assert.equal(report.benchmark, "ocr-model-pack-manager");
  assert.equal(report.modelPackId, "ocr-model-pp-ocrv6-small");
  assert.deepEqual(report.requiredRoles, ["det", "rec", "dictionary"]);
  assert.equal(report.planOnly, true);
  assert.equal(report.includeUserOverlay, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
