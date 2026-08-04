#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CuaDriverMcpDriver } from "../src/cua-driver-mcp-driver.mjs";
import { createPlatformOcrEnvironment, OcrSidecarSession } from "../src/ocr-sidecar.mjs";
import { resolvePhase14Driver } from "../src/phase-1-4-driver.mjs";
import { normalizeRecognizedUiText } from "../src/ui-text-normalization.mjs";
import { sendWindowsUnicodeText } from "../src/windows-unicode-input.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), "..");

if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const report = await runFromCommandLine().catch((error) => ({
    status: "failed",
    gate: "real-unicode-editors",
    error: serializeFailure(error, "preflight"),
  }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "passed" ? 0 : 1;
}

export async function verifyRealUnicodeEditors(config, options = {}) {
  const normalized = validateConfig(config);
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const artifactRoot = resolve(
    options.artifactRoot
      ?? join(packageRoot, "artifacts", "mcp-executable", packageJson.version, `${process.platform}-${process.arch}`, "artifact"),
  );
  const driverResolution = await resolvePhase14Driver({
    packageRoot,
    packageVersion: packageJson.version,
    env: options.env ?? process.env,
  });
  const ocrEnvironment = createPlatformOcrEnvironment({
    modelRoot: join(artifactRoot, "ocr", "models"),
    runtimeRoot: join(artifactRoot, "ocr", "runtime"),
    baseEnvironment: options.env ?? process.env,
    networkDisabled: true,
    platform: process.platform,
  });
  const driver = options.driver ?? new CuaDriverMcpDriver({
    driverPath: driverResolution.path,
    unicodeInput: sendWindowsUnicodeText,
  });
  const ocr = options.ocr ?? new OcrSidecarSession({ environment: ocrEnvironment });
  const tempRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-atomic-input-"));
  const attempts = [];

  try {
    await ocr.start();
    const ocrHealth = await ocr.doctor();
    if (ocrHealth.status !== "healthy" || ocrHealth.networkDisabled !== true) {
      throw proofError("ocr-preflight", "not-applied", "atomic.ocr_not_offline_healthy", {
        status: ocrHealth.status,
        networkDisabled: ocrHealth.networkDisabled,
      });
    }
    const window = await driver.findWindow(normalized.window);
    if (normalized.expectedProcessId && window.pid !== normalized.expectedProcessId) {
      throw proofError("window-identity", "not-applied", "atomic.window_process_mismatch", {
        expectedProcessId: normalized.expectedProcessId,
        actualProcessId: window.pid,
      });
    }

    for (const editor of normalized.editors) {
      const cancellation = await verifyCancellationBoundary({
        driver,
        ocr,
        window,
        editor,
        tempRoot,
        cancelAfterMs: normalized.cancelAfterMs,
      });
      attempts.push(cancellation);
      if (cancellation.status !== "cancelled") {
        throw proofError("cancel", "indeterminate", "atomic.cancel_not_observed", cancellation);
      }

      let consecutiveSuccesses = 0;
      for (let iteration = 1; iteration <= normalized.iterations; iteration += 1) {
        const value = materializeValue(editor, iteration);
        const attempt = await verifyOneEntry({
          driver,
          ocr,
          window,
          editor,
          value,
          iteration,
          tempRoot,
        });
        attempts.push(attempt);
        if (attempt.status !== "passed") {
          return failedReport({
            normalized,
            driverResolution,
            ocrHealth,
            window,
            attempts,
            failedAttempt: attempt,
          });
        }
        consecutiveSuccesses += 1;
      }
      if (consecutiveSuccesses < normalized.iterations) {
        throw proofError("consecutive-success", "not-applied", "atomic.insufficient_consecutive_successes", {
          editorId: editor.id,
          consecutiveSuccesses,
        });
      }
    }

    return {
      status: "passed",
      gate: "real-unicode-editors",
      agentUsed: false,
      llmUsed: false,
      iterationsPerEditor: normalized.iterations,
      editorCount: normalized.editors.length,
      driver: { source: driverResolution.source, version: driverResolution.version },
      ocr: redactOcrHealth(ocrHealth),
      window: { windowId: String(window.windowId), processId: window.pid },
      attempts,
    };
  } catch (error) {
    return {
      status: "failed",
      gate: "real-unicode-editors",
      agentUsed: false,
      llmUsed: false,
      attempts,
      error: serializeFailure(error, "execution"),
    };
  } finally {
    await ocr.close().catch(() => {});
    await driver.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyOneEntry({ driver, ocr, window, editor, value, iteration, tempRoot }) {
  const beforePath = join(tempRoot, `${safeId(editor.id)}-${iteration}-before.png`);
  const afterPath = join(tempRoot, `${safeId(editor.id)}-${iteration}-after.png`);
  let latestSideEffects = null;
  try {
    const before = await driver.captureScreenshot({ window, outputPath: beforePath });
    const provenance = coordinateProvenance(before, editor.bounds, await sha256File(beforePath));
    const nativePoint = transformPoint(center(editor.bounds), before.coordinateScale?.actionTransform);
    const result = await driver.typeText({
      window,
      x: nativePoint.x,
      y: nativePoint.y,
      value,
      textMode: "replace-all",
      inputBehavior: editor.inputBehavior,
      deliveryMode: "foreground",
    });
    latestSideEffects = actionSideEffects(result);
    if (result?.effect === "not-applied" || result?.status === "error") {
      throw proofError("focus-or-entry", "not-applied", "atomic.input_not_applied", {
        result: redactActionResult(result),
      });
    }
    const readback = await waitForStableReadback({
      driver,
      ocr,
      window,
      crop: editor.readbackBounds,
      firstPath: afterPath,
      pathPrefix: join(tempRoot, `${safeId(editor.id)}-${iteration}-stable`),
    });
    const matched = compareReadback(readback.text, value, editor.comparison);
    return {
      status: matched ? "passed" : "failed",
      editorId: editor.id,
      iteration,
      valueSha256: sha256Text(value),
      readbackSha256: sha256Text(readback.text),
      phase: matched ? "readback" : "readback-mismatch",
      effect: matched ? "committed" : "indeterminate",
      sideEffects: matched
        ? { ...actionSideEffects(result), text: "applied-and-readback-verified" }
        : actionSideEffects(result),
      coordinate: provenance,
      afterScreenshotId: readback.screenshotId,
      ocrItemCount: readback.itemCount,
      stableObservationCount: readback.stableObservationCount,
    };
  } catch (error) {
    return {
      status: "failed",
      editorId: editor.id,
      iteration,
      valueSha256: sha256Text(value),
      ...serializeFailure(error, "entry"),
      ...(latestSideEffects ? { sideEffects: latestSideEffects } : {}),
    };
  }
}

async function verifyCancellationBoundary({ driver, ocr, window, editor, tempRoot, cancelAfterMs }) {
  const beforePath = join(tempRoot, `${safeId(editor.id)}-cancel-before.png`);
  const afterPath = join(tempRoot, `${safeId(editor.id)}-cancel-after.png`);
  const value = materializeValue(editor, 0);
  const controller = new AbortController();
  const before = await driver.captureScreenshot({ window, outputPath: beforePath });
  const beforeReadback = await recognizeRegion(ocr, beforePath, editor.readbackBounds);
  const nativePoint = transformPoint(center(editor.bounds), before.coordinateScale?.actionTransform);
  const operation = driver.typeText({
    window,
    x: nativePoint.x,
    y: nativePoint.y,
    value,
    textMode: "replace-all",
    inputBehavior: editor.inputBehavior,
    deliveryMode: "foreground",
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort("atomic-cancel-proof"), cancelAfterMs);
  let cancellation;
  try {
    const result = await operation;
    cancellation = {
      status: "completed-before-cancel",
      stage: "bridge-execution",
      effect: result?.verified === true ? "committed" : "indeterminate",
      sideEffects: actionSideEffects(result),
    };
  } catch (error) {
    cancellation = {
      status: error?.name === "AbortError" || error?.code === "operation.cancelled" ? "cancelled" : "failed",
      ...serializeFailure(error, "bridge-execution"),
    };
  } finally {
    clearTimeout(timer);
  }
  const after = await driver.captureScreenshot({ window, outputPath: afterPath });
  const afterReadback = await recognizeRegion(ocr, afterPath, editor.readbackBounds);
  return {
    editorId: editor.id,
    proof: "in-flight-cancel",
    ...cancellation,
    observedTextChanged: sha256Text(beforeReadback.text) !== sha256Text(afterReadback.text),
    beforeReadbackSha256: sha256Text(beforeReadback.text),
    afterReadbackSha256: sha256Text(afterReadback.text),
    coordinate: coordinateProvenance(before, editor.bounds, await sha256File(beforePath)),
    afterScreenshotId: await sha256File(afterPath),
  };
}

async function recognizeRegion(ocr, imagePath, crop) {
  const response = await ocr.recognize({
    imagePath,
    crop,
    languages: ["zh", "en"],
    noCache: true,
    timeoutMs: 15_000,
  });
  const items = Array.isArray(response.items) ? [...response.items] : [];
  items.sort((left, right) => Number(left.bounds?.y ?? 0) - Number(right.bounds?.y ?? 0)
    || Number(left.bounds?.x ?? 0) - Number(right.bounds?.x ?? 0));
  return {
    text: normalizeForComparison(items.map((item) => item.text ?? "").join("")),
    itemCount: items.length,
  };
}

async function waitForStableReadback({ driver, ocr, window, crop, firstPath, pathPrefix }) {
  const agreementCounts = new Map();
  let latest = null;
  for (let observation = 1; observation <= 6; observation += 1) {
    const imagePath = observation === 1 ? firstPath : `${pathPrefix}-${observation}.png`;
    const capture = await driver.captureScreenshot({ window, outputPath: imagePath });
    assertSameWindow(window, capture);
    const recognized = await recognizeRegion(ocr, imagePath, crop);
    const stableObservationCount = (agreementCounts.get(recognized.text) ?? 0) + 1;
    agreementCounts.set(recognized.text, stableObservationCount);
    latest = {
      ...recognized,
      screenshotId: await sha256File(imagePath),
      stableObservationCount,
    };
    if (stableObservationCount >= 2) return latest;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw proofError("readback-stability", "indeterminate", "atomic.readback_not_stable", {
    stableObservationCount: Math.max(0, ...agreementCounts.values()),
    screenshotId: latest?.screenshotId ?? null,
  });
}

function validateConfig(config) {
  if (!config || config.schemaVersion !== 1) throw proofError("config", "not-applied", "atomic.config_version_invalid");
  const window = config.window;
  const selectors = [window?.target === "foreground", window?.windowId !== undefined, nonEmpty(window?.titlePart)].filter(Boolean);
  if (selectors.length !== 1) throw proofError("config", "not-applied", "atomic.window_selector_invalid");
  const iterations = Number(config.iterations ?? 20);
  if (!Number.isInteger(iterations) || iterations < 20) throw proofError("config", "not-applied", "atomic.iterations_below_twenty");
  if (!Array.isArray(config.editors) || config.editors.length < 1) {
    throw proofError("config", "not-applied", "atomic.editor_required");
  }
  return {
    window,
    expectedProcessId: Number.isInteger(config.expectedProcessId) ? config.expectedProcessId : null,
    iterations,
    cancelAfterMs: Math.max(1, Number(config.cancelAfterMs ?? 10)),
    editors: config.editors.map((editor) => {
      if (!nonEmpty(editor.id) || editor.role !== "editable") throw proofError("config", "not-applied", "atomic.editor_identity_invalid");
      const bounds = validatedBounds(editor.bounds, "atomic.editor_bounds_invalid");
      const readbackBounds = validatedBounds(editor.readbackBounds ?? editor.bounds, "atomic.readback_bounds_invalid");
      if (!contains(bounds, readbackBounds)) {
        throw proofError("config", "not-applied", "atomic.readback_outside_editor", { editorId: editor.id });
      }
      const values = Array.isArray(editor.valuesBase64)
        ? editor.valuesBase64.map((value) => Buffer.from(String(value), "base64").toString("utf8"))
        : editor.values;
      if (!Array.isArray(values) || values.length < iterations + 1
        || values.some((value) => !nonEmpty(value) || !/[^\x00-\x7f]/u.test(value))) {
        throw proofError("config", "not-applied", "atomic.chinese_values_missing", { editorId: editor.id });
      }
      return {
        id: editor.id,
        role: editor.role,
        bounds,
        readbackBounds,
        values,
        inputBehavior: editor.inputBehavior === "incremental" ? "incremental" : "commit",
        comparison: ["contains", "value-with-caret"].includes(editor.comparison)
          ? editor.comparison
          : "exact",
      };
    }),
  };
}

function materializeValue(editor, iteration) {
  return editor.values[iteration];
}

function coordinateProvenance(capture, crop, screenshotId) {
  assertSameWindow({ windowId: capture.window?.id ?? capture.hwnd, pid: capture.window?.pid }, capture);
  const width = capture.coordinateScale?.observationPixels?.width ?? capture.width;
  const height = capture.coordinateScale?.observationPixels?.height ?? capture.height;
  if (!contains({ x: 0, y: 0, width, height }, crop)) {
    throw proofError("coordinate-provenance", "not-applied", "atomic.editor_outside_screenshot");
  }
  return {
    screenshotId,
    windowId: String(capture.window?.id ?? capture.hwnd),
    coordinateSpace: capture.coordinateScale?.sourceSpace ?? "screenshot-pixel",
    cropOffset: { x: crop.x, y: crop.y },
    scale: { ...capture.coordinateScale?.actionTransform },
  };
}

function assertSameWindow(window, capture) {
  const expected = String(window.windowId ?? window.id);
  const actual = String(capture.window?.id ?? capture.hwnd);
  if (expected !== actual || (window.pid && capture.window?.pid && window.pid !== capture.window.pid)) {
    throw proofError("window-identity", "not-applied", "atomic.capture_window_mismatch", { expected, actual });
  }
}

function compareReadback(observed, expected, comparison) {
  const normalizedExpected = normalizeForComparison(expected);
  if (comparison === "value-with-caret") {
    return observed === normalizedExpected
      || (observed.startsWith(normalizedExpected)
        && [...observed].length === [...normalizedExpected].length + 1);
  }
  return comparison === "contains"
    ? observed.includes(normalizedExpected)
    : observed === normalizedExpected;
}

function normalizeForComparison(value) {
  return normalizeRecognizedUiText(String(value ?? ""), { languageClass: "mixed" }).replace(/\s+/gu, "");
}

function center(bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

function transformPoint(point, transform = {}) {
  return {
    x: point.x * (transform.scaleX ?? 1) + (transform.offsetX ?? 0),
    y: point.y * (transform.scaleY ?? 1) + (transform.offsetY ?? 0),
  };
}

function validatedBounds(value, code) {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)
    || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0) {
    throw proofError("config", "not-applied", code);
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function contains(parent, child) {
  return [parent?.x, parent?.y, parent?.width, parent?.height].every(Number.isFinite)
    && child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

function actionSideEffects(result) {
  return result?.sideEffects ?? {
    focus: result?.focusVerified === true ? "applied" : "indeterminate",
    selection: "indeterminate",
    text: result?.verified === true ? "applied" : "indeterminate",
    clipboard: result?.clipboardRestored === true ? "restored" : "indeterminate",
    ime: "indeterminate",
  };
}

function failedReport({ normalized, driverResolution, ocrHealth, window, attempts, failedAttempt }) {
  return {
    status: "failed",
    gate: "real-unicode-editors",
    agentUsed: false,
    llmUsed: false,
    iterationsPerEditor: normalized.iterations,
    driver: { source: driverResolution.source, version: driverResolution.version },
    ocr: redactOcrHealth(ocrHealth),
    window: { windowId: String(window.windowId), processId: window.pid },
    attempts,
    error: {
      code: "atomic.readback_failed",
      stage: failedAttempt.phase,
      effect: failedAttempt.effect,
      sideEffects: failedAttempt.sideEffects,
    },
  };
}

function redactOcrHealth(health) {
  return {
    status: health.status,
    modelPack: health.modelPack,
    modelFormat: health.modelFormat,
    executionProvider: health.executionProvider,
    networkDisabled: health.networkDisabled,
  };
}

function redactActionResult(result) {
  if (!result || typeof result !== "object") return result;
  return Object.fromEntries(Object.entries(result).filter(([key]) => !/text|value|clipboard/i.test(key)));
}

function serializeFailure(error, fallbackStage) {
  return {
    code: error?.code ?? "atomic.unexpected_failure",
    message: sanitizeFailureMessage(error?.message),
    stage: error?.detail?.stage ?? error?.stage ?? fallbackStage,
    effect: error?.detail?.effect ?? error?.effect ?? "indeterminate",
    sideEffects: error?.detail?.sideEffects ?? error?.sideEffects ?? {
      focus: "indeterminate",
      selection: "indeterminate",
      text: "indeterminate",
      clipboard: "indeterminate",
      ime: "indeterminate",
    },
    ...(error?.detail ? { detail: redactDetail(error.detail) } : {}),
  };
}

function sanitizeFailureMessage(value) {
  const message = typeof value === "string" ? value : "Unexpected failure.";
  return message.replace(/[^\x20-\x7e]/gu, "?").slice(0, 240);
}

function redactDetail(detail) {
  return Object.fromEntries(Object.entries(detail).filter(([key]) => !/text|value|title/i.test(key)));
}

function proofError(stage, effect, code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.stage = stage;
  error.effect = effect;
  error.detail = { stage, effect, ...detail };
  return error;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function safeId(value) {
  return basename(String(value)).replace(/[^a-z0-9_-]/giu, "-");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

async function runFromCommandLine() {
  const configArg = process.argv[2];
  if (!configArg) throw proofError("config", "not-applied", "atomic.config_path_required");
  const raw = configArg === "-" ? await readStdin() : await readFile(resolve(configArg), "utf8");
  return verifyRealUnicodeEditors(JSON.parse(raw.replace(/^\uFEFF/u, "")));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
