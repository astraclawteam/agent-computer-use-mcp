#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "ppu-ocv";
import { PaddleOcrService } from "ppu-paddle-ocr";
import * as ort from "onnxruntime-node";

const PROVIDER = "xiaozhiclaw-ocr-sidecar";
const ENGINE = "node-onnxruntime-native";
const MODEL_FAMILY = "PP-OCRv6";
const MODEL_PACK = "pp-ocrv6-small";

const runtimePriority = [
  {
    backend: "cuda",
    runtime: "onnxruntime-cuda",
    executionProvider: "CUDAExecutionProvider",
    acceleration: "gpu",
    providers: ["cuda", "cpu"],
  },
  {
    backend: "dml",
    runtime: "onnxruntime-directml",
    executionProvider: "DmlExecutionProvider",
    acceleration: "gpu",
    providers: ["dml", "cpu"],
    requiresOnnxModelPack: true,
  },
  {
    backend: "cpu",
    runtime: "onnxruntime-cpu",
    executionProvider: "CPUExecutionProvider",
    acceleration: "cpu",
    providers: ["cpu"],
  },
];

export async function runOcrSidecar(options = {}) {
  const command = options.command ?? process.argv[2] ?? "doctor";
  try {
    if (command === "doctor") {
      printJson(await doctor());
    } else if (command === "recognize") {
      const request = JSON.parse(await readStdin());
      printJson(await recognize(request));
    } else if (command === "serve") {
      await serve();
    } else {
      printJson({ status: "error", provider: PROVIDER, reason: `unknown command: ${command}` });
      process.exitCode = 2;
    }
  } catch (error) {
    printJson({
      status: "error",
      provider: PROVIDER,
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
}

export function shouldAutoStartOcrSidecar(options = {}) {
  const argv = options.argv ?? process.argv;
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  return Boolean(argv[1]) && resolve(argv[1]) === fileURLToPath(moduleUrl);
}

if (shouldAutoStartOcrSidecar()) {
  await runOcrSidecar();
}

async function doctor() {
  const supportedBackends = await supportedOrtBackends();
  const modelPack = resolveModelPack();
  const selected = selectNativeRuntime(supportedBackends, modelPack);
  return {
    status: "healthy",
    provider: PROVIDER,
    engine: ENGINE,
    modelFamily: MODEL_FAMILY,
    modelPack: MODEL_PACK,
    runtime: selected.runtime,
    executionProvider: selected.executionProvider,
    acceleration: selected.acceleration,
    supportedBackends,
    executionProviders: selected.providers,
    modelFormat: modelPack.format,
    modelPaths: modelPack.paths,
    networkDisabled: isNetworkDisabled(),
  };
}

async function recognize(request) {
  const supportedBackends = await supportedOrtBackends();
  const modelPack = resolveModelPack();
  const selected = selectNativeRuntime(supportedBackends, modelPack);
  const imageInput = await resolveImageBuffer(request);
  const started = performance.now();
  const result = await runOcrWithFallback(imageInput.buffer, selected, modelPack, request);
  const totalMs = performance.now() - started;

  return {
    status: "ok",
    provider: PROVIDER,
    engine: ENGINE,
    modelFamily: MODEL_FAMILY,
    modelPack: MODEL_PACK,
    runtime: result.selected.runtime,
    executionProvider: result.selected.executionProvider,
    acceleration: result.selected.acceleration,
    supportedBackends,
    executionProviders: result.selected.providers,
    modelFormat: modelPack.format,
    crop: imageInput.crop,
    fixture: request.fixture ?? null,
    items: result.ocr.results.map((item) => ({
      text: item.text,
      bounds: translateBounds(item.box, imageInput.crop),
      confidence: item.confidence,
      source: "ocr",
    })),
    timings: {
      preprocessMs: 0,
      inferMs: Math.round(totalMs * 10) / 10,
      postprocessMs: 0,
      totalMs: Math.round(totalMs * 10) / 10,
    },
  };
}

async function serve() {
  const daemon = createDaemon();
  let pending = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      await handleDaemonLine(daemon, line);
    }
  }
  await daemon.destroy();
}

async function handleDaemonLine(daemon, line) {
  let message;
  try {
    message = JSON.parse(line.replace(/^\uFEFF/, ""));
  } catch (error) {
    printJson({ id: null, ok: false, error: `invalid json: ${error.message}` });
    return;
  }

  try {
    if (message.method === "doctor") {
      printJson({ id: message.id, ok: true, result: await daemon.doctor() });
    } else if (message.method === "recognize") {
      printJson({ id: message.id, ok: true, result: await daemon.recognize(message.params ?? {}) });
    } else if (message.method === "shutdown") {
      printJson({ id: message.id, ok: true, result: { status: "ok" } });
      await daemon.destroy();
      process.exitCode = 0;
      process.stdin.destroy();
    } else {
      printJson({ id: message.id, ok: false, error: `unknown method: ${message.method}` });
    }
  } catch (error) {
    printJson({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function createDaemon() {
  const supportedBackendsPromise = supportedOrtBackends();
  const modelPack = resolveModelPack();
  let selected = null;
  let service = null;
  let initialized = null;
  let lastHealth = null;
  const resultCache = new Map();

  async function ensureInitialized() {
    if (initialized) return initialized;
    initialized = (async () => {
      const supportedBackends = await supportedBackendsPromise;
      selected = selectNativeRuntime(supportedBackends, modelPack);
      service = new PaddleOcrService({
        model: modelPack.model,
        detection: { maxSideLength: 1280 },
        session: {
          executionProviders: selected.providers,
          enableMemPattern: false,
          executionMode: "sequential",
        },
        processing: { engine: "opencv" },
      });
      const started = performance.now();
      await service.initialize();
      lastHealth = {
        status: "healthy",
        provider: PROVIDER,
        engine: ENGINE,
        modelFamily: MODEL_FAMILY,
        modelPack: MODEL_PACK,
        runtime: selected.runtime,
        executionProvider: selected.executionProvider,
        acceleration: selected.acceleration,
        supportedBackends,
        executionProviders: selected.providers,
        modelFormat: modelPack.format,
        modelPaths: modelPack.paths,
        networkDisabled: isNetworkDisabled(),
        sessionMode: "daemon",
        initialized: true,
        initMs: Math.round((performance.now() - started) * 10) / 10,
      };
      return lastHealth;
    })();
    return initialized;
  }

  return {
    async doctor() {
      return ensureInitialized();
    },

    async recognize(request) {
      const health = await ensureInitialized();
      const imageInput = await resolveImageBuffer(request);
      const cacheKey = createCacheKey(imageInput.buffer, imageInput.crop, health);
      if (!request.noCache && resultCache.has(cacheKey)) {
        const cached = resultCache.get(cacheKey);
        return {
          ...cached,
          cacheHit: true,
          timings: { preprocessMs: 0, inferMs: 0, postprocessMs: 0, totalMs: 0 },
        };
      }

      const started = performance.now();
      const ocr = await service.recognize(toArrayBuffer(imageInput.buffer), {
        flatten: true,
        strategy: "per-box",
        noCache: Boolean(request.noCache),
      });
      const totalMs = performance.now() - started;
      if (ocr.results.length === 0) {
        throw new Error(`${health.executionProvider} returned no OCR results`);
      }

      const response = {
        status: "ok",
        provider: PROVIDER,
        engine: ENGINE,
        modelFamily: MODEL_FAMILY,
        modelPack: MODEL_PACK,
        runtime: health.runtime,
        executionProvider: health.executionProvider,
        acceleration: health.acceleration,
        supportedBackends: health.supportedBackends,
        executionProviders: health.executionProviders,
        modelFormat: health.modelFormat,
        sessionMode: "daemon",
        cacheHit: false,
        crop: imageInput.crop,
        fixture: request.fixture ?? null,
        items: ocr.results.map((item) => ({
          text: item.text,
          bounds: translateBounds(item.box, imageInput.crop),
          confidence: item.confidence,
          source: "ocr",
        })),
        timings: {
          preprocessMs: 0,
          inferMs: Math.round(totalMs * 10) / 10,
          postprocessMs: 0,
          totalMs: Math.round(totalMs * 10) / 10,
        },
      };
      if (!request.noCache) {
        resultCache.set(cacheKey, response);
      }
      return response;
    },

    async destroy() {
      if (service) {
        await service.destroy().catch(() => {});
      }
      service = null;
      initialized = null;
    },
  };
}

async function runOcrWithFallback(imageBuffer, selected, modelPack, request = {}) {
  const attempts = [selected];
  if (selected.executionProvider !== "CPUExecutionProvider") {
    attempts.push(runtimePriority[runtimePriority.length - 1]);
  }

  let lastError = null;
  for (const attempt of attempts) {
    const service = new PaddleOcrService({
      model: modelPack.model,
      detection: { maxSideLength: 1280 },
      session: {
        executionProviders: attempt.providers,
        enableMemPattern: false,
        executionMode: "sequential",
      },
      processing: { engine: "opencv" },
    });
    try {
      await service.initialize();
      const ocr = await service.recognize(toArrayBuffer(imageBuffer), {
        flatten: true,
        strategy: "per-box",
        noCache: Boolean(request?.noCache),
      });
      await service.destroy();
      if (ocr.results.length === 0 && attempt.executionProvider !== "CPUExecutionProvider") {
        lastError = new Error(`${attempt.executionProvider} returned no OCR results; falling back to CPU`);
        continue;
      }
      return { selected: attempt, ocr };
    } catch (error) {
      lastError = error;
      await service.destroy().catch(() => {});
    }
  }

  throw lastError ?? new Error("ocr failed without an error");
}

async function resolveImageBuffer(request) {
  let buffer;
  if (request.imagePath) {
    buffer = await readFile(request.imagePath);
  } else if (request.fixture === "canvas-lab") {
    buffer = createCanvasLabPng();
  } else {
    throw new Error("imagePath or fixture is required");
  }

  if (request.crop) {
    return {
      buffer: await cropImage(buffer, request.crop),
      crop: request.crop,
    };
  }
  return { buffer, crop: null };
}

async function cropImage(buffer, crop) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(crop.width, crop.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas.toBuffer("image/png");
}

function createCanvasLabPng() {
  const canvas = createCanvas(900, 520);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 900, 520);

  ctx.fillStyle = "black";
  ctx.font = "42px Arial, sans-serif";
  ctx.fillText("Canvas Computer Use Lab", 116, 154);

  ctx.font = "27px Arial, sans-serif";
  ctx.fillText("Name", 116, 214);

  ctx.font = "26px Arial, sans-serif";
  ctx.fillText("xiaozhi", 128, 255);
  ctx.fillText("Save", 648, 255);

  ctx.font = "27px Arial, sans-serif";
  ctx.fillText("Status", 116, 340);

  ctx.font = "26px Arial, sans-serif";
  ctx.fillText("Saved: xiaozhi", 116, 374);

  const buffer = canvas.toBuffer("image/png");
  return buffer;
}

async function supportedOrtBackends() {
  const supported = await ort.listSupportedBackends();
  return supported.map((backend) => backend.name);
}

function selectNativeRuntime(supportedBackends, modelPack) {
  const supported = new Set(supportedBackends);
  return runtimePriority.find((runtime) => {
    if (!supported.has(runtime.backend)) return false;
    if (runtime.requiresOnnxModelPack && modelPack.format !== "onnx") return false;
    return true;
  })
    ?? runtimePriority[runtimePriority.length - 1];
}

function resolveModelPack() {
  const configuredModelDir = process.env.AGENT_COMPUTER_USE_OCR_MODEL_DIR
    ?? process.env.XIAOZHICLAW_OCR_MODEL_DIR;
  const modelDir = resolve(configuredModelDir
    ?? join(homedir(), ".cache", "agent-computer-use", "ocr", "pp-ocrv6-small"));
  const paths = {
    detection: join(modelDir, "PP-OCRv6_det_small.onnx"),
    recognition: join(modelDir, "PP-OCRv6_rec_small.onnx"),
    charactersDictionary: join(modelDir, "ppocrv6_dict.txt"),
  };
  const hasOnnxPack = Object.values(paths).every((path) => existsSync(path));
  if (hasOnnxPack) {
    return {
      format: "onnx",
      model: paths,
      paths,
    };
  }

  if (configuredModelDir || isNetworkDisabled()) {
    throw new Error(`ocr.offline_model_pack_missing: ${modelDir}`);
  }

  return {
    format: "ort-default",
    model: {},
    paths: {},
  };
}

function isNetworkDisabled() {
  return process.env.AGENT_COMPUTER_USE_NETWORK_DISABLED === "1";
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function translateBounds(bounds, crop) {
  if (!crop) return bounds;
  return {
    x: bounds.x + crop.x,
    y: bounds.y + crop.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function createCacheKey(buffer, crop, health) {
  const hash = createHash("sha256");
  hash.update(buffer);
  hash.update(JSON.stringify({
    crop,
    modelPack: health.modelPack,
    modelFormat: health.modelFormat,
    runtime: health.runtime,
  }));
  return hash.digest("hex");
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
  }
  return input.replace(/^\uFEFF/, "");
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
