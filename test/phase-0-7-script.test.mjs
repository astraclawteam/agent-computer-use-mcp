import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("Phase 0.7 exposes an executable OCR sidecar MVP script", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts["phase:0.7"], "node src/phase-0-7.mjs");
  assert.equal(existsSync("src/phase-0-7.mjs"), true);
  assert.equal(existsSync("ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs"), true);

  const runner = readFileSync("src/phase-0-7.mjs", "utf8");
  assert.match(runner, /OcrSidecarSession/);
  assert.match(runner, /await session\.start\(\)/);
  assert.match(runner, /await session\.doctor\(\)/);
  assert.match(runner, /await session\.recognize\(/);
  assert.match(runner, /await session\.close\(\)/);
  assert.match(runner, /noCache:\s*true/);
  assert.match(runner, /cacheHit/);
  assert.match(runner, /crop:\s*{/);
  assert.match(runner, /startGatewayManagedOverlay/);
  assert.match(runner, /stopGatewayManagedOverlay/);
  assert.match(runner, /try\s*{/);
  assert.match(runner, /finally\s*{/);
  assert.match(runner, /fixture:\s*"canvas-lab"/);
  assert.match(runner, /normalizeOcrSidecarResponse/);

  const sidecar = readFileSync("ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs", "utf8");
  assert.match(sidecar, /xiaozhiclaw-ocr-sidecar/);
  assert.match(sidecar, /serve/);
  assert.match(sidecar, /ensureInitialized/);
  assert.match(sidecar, /PP-OCRv6/);
  assert.match(sidecar, /CUDAExecutionProvider/);
  assert.match(sidecar, /DmlExecutionProvider/);
  assert.match(sidecar, /CPUExecutionProvider/);
  assert.match(sidecar, /falling back to CPU/);
});

test("Phase 0.7 benchmark locks product latency targets for warm region OCR", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts["phase:0.7:bench"], "node src/phase-0-7-benchmark.mjs");
  assert.equal(existsSync("src/phase-0-7-benchmark.mjs"), true);

  const benchmark = readFileSync("src/phase-0-7-benchmark.mjs", "utf8");
  assert.match(benchmark, /small-ui-crop/);
  assert.match(benchmark, /ordinary-window-region/);
  assert.match(benchmark, /full-window/);
  assert.match(benchmark, /targetMs:\s*200/);
  assert.match(benchmark, /targetMs:\s*300/);
  assert.match(benchmark, /firstRunTargetMs:\s*1000/);
  assert.match(benchmark, /warmRuns/);
  assert.match(benchmark, /shapeWarmupMs/);
  assert.match(benchmark, /cacheHit/);
  assert.match(benchmark, /startGatewayManagedOverlay/);
  assert.match(benchmark, /includeUserOverlay:\s*false/);
});

test("Phase 0.8 benchmark uses real window screenshots and dirty-region OCR", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts["phase:0.8"], "node src/phase-0-8-real-window-diff-ocr.mjs");
  assert.equal(existsSync("src/phase-0-8-real-window-diff-ocr.mjs"), true);
  assert.equal(existsSync("src/real-window-capture.mjs"), true);
  assert.equal(existsSync("src/image-diff.mjs"), true);

  const runner = readFileSync("src/phase-0-8-real-window-diff-ocr.mjs", "utf8");
  assert.match(runner, /captureWindowPngByTitle/);
  assert.match(runner, /computeDirtyRegion/);
  assert.match(runner, /expandRegionToBucket/);
  assert.match(runner, /prewarmOcrBuckets/);
  assert.match(runner, /imagePath/);
  assert.match(runner, /dirtyRegion/);
  assert.match(runner, /ocrRegion/);
  assert.match(runner, /dirtyOcr/);
  assert.match(runner, /baselineCapture/);
  assert.match(runner, /changedCapture/);
  assert.match(runner, /startGatewayManagedOverlay/);
  assert.match(runner, /includeUserOverlay:\s*false/);

  const capture = readFileSync("src/real-window-capture.mjs", "utf8");
  assert.match(capture, /PrintWindow/);
  assert.match(capture, /CaptureWindowPngByTitle/);

  const diff = readFileSync("src/image-diff.mjs", "utf8");
  assert.match(diff, /changedPixels/);
  assert.match(diff, /padding/);
});

test("Phase 1.4 script drives real desktop actions through the MCP module", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts["phase:1.4"], "node src/phase-1-4-real-mcp-action.mjs");
  assert.equal(existsSync("src/phase-1-4-real-mcp-action.mjs"), true);

  const runner = readFileSync("src/phase-1-4-real-mcp-action.mjs", "utf8");
  assert.match(runner, /computer-use-mcp-server\.mjs/);
  assert.match(runner, /computer\.request_access/);
  assert.match(runner, /computer\.capture/);
  assert.match(runner, /computer\.act/);
  assert.match(runner, /computer\.list_state/);
  assert.match(runner, /computer\.cancel/);
  assert.match(runner, /NativeComputerUseLab/);
  assert.match(runner, /includeUserOverlay/);
});
