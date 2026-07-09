import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SIDECAR_PATH = resolveOcrSidecarPath();

const RUNTIME_PRIORITY = [
  {
    executionProvider: "CUDAExecutionProvider",
    runtime: "onnxruntime-cuda",
    acceleration: "gpu",
    rapidOcrParams: { "EngineConfig.onnxruntime.use_cuda": true },
  },
  {
    executionProvider: "DmlExecutionProvider",
    runtime: "onnxruntime-directml",
    acceleration: "gpu",
    rapidOcrParams: { "EngineConfig.onnxruntime.use_dml": true },
  },
  {
    executionProvider: "CoreMLExecutionProvider",
    runtime: "onnxruntime-coreml",
    acceleration: "accelerator",
    rapidOcrParams: { "EngineConfig.onnxruntime.use_coreml": true },
  },
  {
    executionProvider: "CANNExecutionProvider",
    runtime: "onnxruntime-cann",
    acceleration: "accelerator",
    rapidOcrParams: { "EngineConfig.onnxruntime.use_cann": true },
  },
  {
    executionProvider: "CPUExecutionProvider",
    runtime: "onnxruntime-cpu",
    acceleration: "cpu",
    rapidOcrParams: {},
  },
];

export function resolveOcrSidecarPath(options = {}) {
  const env = options.env ?? process.env;
  const moduleDirectory = options.moduleDirectory ?? __dirname;
  const pathExists = options.pathExists ?? existsSync;
  const override = env.AGENT_COMPUTER_USE_OCR_SIDECAR_PATH
    ?? env.XIAOZHICLAW_OCR_SIDECAR_PATH;
  if (override) return override;

  const protectedPath = resolve(moduleDirectory, "ocr-sidecar.mjs");
  if (pathExists(protectedPath)) return protectedPath;
  return resolve(moduleDirectory, "../ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs");
}

export function selectOcrRuntime(availableProviders = []) {
  const providers = new Set(availableProviders);
  const selected = RUNTIME_PRIORITY.find((runtime) => providers.has(runtime.executionProvider))
    ?? RUNTIME_PRIORITY[RUNTIME_PRIORITY.length - 1];

  return {
    runtime: selected.runtime,
    executionProvider: selected.executionProvider,
    acceleration: selected.acceleration,
    rapidOcrParams: { ...selected.rapidOcrParams },
  };
}

export function normalizeOcrSidecarResponse(response, options = {}) {
  const elements = (response.items ?? []).map((item, index) => ({
    elementToken: `ocr-${index + 1}`,
    elementIndex: index,
    role: "text",
    name: String(item.text ?? ""),
    value: String(item.text ?? ""),
    state: {},
    actions: ["click"],
    bounds: normalizeBounds(item.bounds),
    confidence: Number(item.confidence ?? 0),
    source: "ocr",
    pixelLimitedAction: true,
  }));

  return {
    observationId: options.observationId ?? `ocr-obs-${Date.now()}`,
    provider: "gateway-managed",
    source: "ocr",
    mode: "ocr",
    window: options.window,
    modelPack: response.modelPack,
    modelFormat: response.modelFormat,
    sessionMode: response.sessionMode,
    runtime: response.runtime,
    executionProvider: response.executionProvider,
    cacheHit: Boolean(response.cacheHit),
    crop: response.crop ?? null,
    elements,
    text: elements.map((element) => element.name).join("\n"),
    timings: response.timings,
    includeUserOverlay: false,
  };
}

export class OcrSidecarClient {
  constructor(options = {}) {
    this.node = options.node ?? { command: process.execPath, args: [], label: "node" };
    this.sidecarPath = options.sidecarPath ?? DEFAULT_SIDECAR_PATH;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  async doctor() {
    const result = await runCommandJson(this.node, [this.sidecarPath, "doctor"], undefined, this.timeoutMs);
    if (result.ok && result.json?.status === "healthy") {
      return result.json;
    }

    return {
      status: "unavailable",
      reason: "native-sidecar-unavailable",
      detail: result.error ?? result.json,
    };
  }

  async recognize(request) {
    const result = await runCommandJson(
      this.node,
      [this.sidecarPath, "recognize"],
      request,
      request.timeoutMs ?? this.timeoutMs,
    );

    if (!result.ok) {
      throw new Error(`ocr.sidecar_failed: ${result.error}`);
    }
    if (result.json?.status === "error") {
      throw new Error(`ocr.sidecar_failed: ${result.json.reason ?? "unknown"}`);
    }
    return result.json;
  }
}

export class OcrSidecarSession {
  constructor(options = {}) {
    this.node = options.node ?? { command: process.execPath, args: [], label: "node" };
    this.sidecarPath = options.sidecarPath ?? DEFAULT_SIDECAR_PATH;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.stderr = "";
  }

  async start() {
    if (this.child) return this;
    this.child = spawn(this.node.command, [...this.node.args, this.sidecarPath, "serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code) => this.rejectAll(new Error(`ocr.sidecar_exited: ${code}`)));
    this.child.on("error", (error) => this.rejectAll(error));
    return this;
  }

  async doctor() {
    return this.request("doctor", {});
  }

  async recognize(request) {
    return this.request("recognize", request, request.timeoutMs ?? this.timeoutMs);
  }

  async close() {
    if (!this.child) return;
    try {
      await this.request("shutdown", {}, 1500);
    } catch {
      // The process may close before answering shutdown; killing below is enough for MVP cleanup.
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }

  request(method, params = {}, timeoutMs = this.timeoutMs) {
    if (!this.child) {
      throw new Error("ocr.sidecar_session_not_started");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ocr.sidecar_timeout: ${method} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${payload}\n`, "utf8");
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.rejectAll(new Error(`ocr.sidecar_invalid_json: ${error.message}; line=${line}`));
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(`ocr.sidecar_failed: ${message.error}; stderr=${this.stderr}`));
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function normalizeBounds(bounds) {
  if (Array.isArray(bounds)) {
    const points = bounds.flatMap((point) => Array.isArray(point) ? [point] : []);
    const xs = points.map((point) => Number(point[0]));
    const ys = points.map((point) => Number(point[1]));
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  return {
    x: Number(bounds?.x ?? 0),
    y: Number(bounds?.y ?? 0),
    width: Number(bounds?.width ?? 0),
    height: Number(bounds?.height ?? 0),
  };
}

async function runCommandJson(commandSpec, args, input, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(commandSpec.command, [...commandSpec.args, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      resolvePromise({ ok: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: false, error: error.message });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolvePromise({ ok: false, error: stderr || stdout || `exit ${code}` });
        return;
      }
      try {
        resolvePromise({ ok: true, json: JSON.parse(stdout) });
      } catch (error) {
        resolvePromise({ ok: false, error: `invalid json: ${error.message}; stdout=${stdout}; stderr=${stderr}` });
      }
    });

    if (input) {
      child.stdin.end(JSON.stringify(input));
    } else {
      child.stdin.end();
    }
  });
}
