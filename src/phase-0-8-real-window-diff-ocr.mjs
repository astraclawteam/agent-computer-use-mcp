import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DEFAULT_OCR_PREWARM_BUCKETS, expandRegionToBucket } from "./crop-bucket.mjs";
import { computeDirtyRegion } from "./image-diff.mjs";
import { OcrSidecarSession } from "./ocr-sidecar.mjs";
import { captureWindowPngByTitle } from "./real-window-capture.mjs";
import { startGatewayManagedOverlay, stopGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const labProject = resolve("native-lab/NativeComputerUseLab.csproj");
const labExe = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const sessionName = "agent-computer-use-phase-0-8-real-window-diff-ocr";
const expectedText = "agent-computer-use-real-diff";
const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-0-8-"));
const outputFile = join(dir, "saved.txt");
const initialCapturePath = join(dir, "initial-window.png");
const baselineCapturePath = join(dir, "baseline-window.png");
const changedCapturePath = join(dir, "changed-window.png");

const overlay = await startGatewayManagedOverlay();
const ocr = new OcrSidecarSession();
const mcp = new CuaDriverMcpClient({ driverPath });
let lab = null;
let driverSessionStarted = false;

try {
  if (!existsSync(labExe)) {
    await run("dotnet", ["build", labProject], { windowsHide: true });
  }

  await ocr.start();
  const doctor = await ocr.doctor();
  const prewarm = await prewarmOcrBuckets(ocr);
  await mcp.start();
  await mcp.callTool("start_session", { session: sessionName });
  driverSessionStarted = true;
  await mcp.callTool("set_agent_cursor_enabled", { enabled: true, cursor_id: "default" });

  lab = spawn(labExe, [outputFile], {
    stdio: "ignore",
    windowsHide: false,
  });

  const window = await waitForWindow(mcp, basename(outputFile));
  await publishOverlayTargetRect(overlay.targetRectFile, window);

  const state = structured(await mcp.callTool("get_window_state", {
    pid: window.pid,
    window_id: window.window_id,
    include_screenshot: false,
    max_elements: 500,
    max_depth: 20,
    session: sessionName,
  }));
  const name = state.elements.find((element) => element.role === "Edit" && element.label === "Name")
    ?? state.elements.find((element) => element.role === "Edit");
  const save = state.elements.find((element) => element.role === "Button" && element.label === "Save");
  if (!name || !save) {
    throw new Error("native_lab.elements_missing");
  }

  const initialCapture = await captureWindowPngByTitle(window.title, initialCapturePath);
  const contentRegion = nativeLabContentRegion(name, save, initialCapture);
  const fullWindowOcr = await ocr.recognize({
    imagePath: initialCapture.path,
    languages: ["zh", "en"],
    timeoutMs: 15000,
    noCache: true,
  });
  const contentRegionOcr = await ocr.recognize({
    imagePath: initialCapture.path,
    crop: contentRegion,
    languages: ["zh", "en"],
    timeoutMs: 15000,
    noCache: true,
  });

  await mcp.callTool("set_value", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: name.element_index,
    value: expectedText,
    session: sessionName,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  const baselineCapture = await captureWindowPngByTitle(window.title, baselineCapturePath);

  if (save.frame) {
    await mcp.callTool("move_cursor", {
      session: sessionName,
      cursor_id: "default",
      x: save.frame.x + save.frame.w / 2,
      y: save.frame.y + save.frame.h / 2,
    });
  }
  await mcp.callTool("click", {
    pid: window.pid,
    window_id: window.window_id,
    element_index: save.element_index,
    delivery_mode: "background",
    session: sessionName,
  });
  await waitForSavedText(outputFile, expectedText);
  const changedCapture = await captureWindowPngByTitle(window.title, changedCapturePath);
  const dirtyRegion = await computeDirtyRegion(baselineCapture.path, changedCapture.path, {
    threshold: 18,
    padding: 36,
  });
  if (!dirtyRegion) {
    throw new Error("dirty_region.not_found");
  }
  const ocrRegion = expandRegionToBucket(dirtyRegion);
  const dirtyOcr = await ocr.recognize({
    imagePath: changedCapture.path,
    crop: ocrRegion,
    languages: ["zh", "en"],
    timeoutMs: 15000,
    noCache: true,
  });
  const diskText = await readFile(outputFile, "utf8");

  const fullText = textOf(fullWindowOcr);
  const regionText = textOf(contentRegionOcr);
  const dirtyText = textOf(dirtyOcr);
  const missing = {
    fullWindow: ["Native", "Name", "Save", "Status"].filter((text) => !fullText.includes(text)),
    contentRegion: ["Name", "Save", "Status"].filter((text) => !regionText.includes(text)),
    dirtyRegion: ["Saved", expectedText].filter((text) => !dirtyText.includes(text)),
  };
  const statusText = diskText === expectedText
    && Object.values(missing).every((items) => items.length === 0)
    ? "passed"
    : "failed";

  console.log(JSON.stringify({
    status: statusText,
    phase: "0.8",
    benchmark: "real-window-dirty-region-ocr",
    gatewayManagedOverlay: {
      visible: overlay.visible,
      userOnly: true,
      includeUserOverlay: false,
      processId: overlay.processId,
    },
    provider: doctor.provider,
    engine: doctor.engine,
    modelPack: doctor.modelPack,
    modelFormat: doctor.modelFormat,
    sessionMode: doctor.sessionMode,
    runtime: doctor.runtime,
    executionProvider: doctor.executionProvider,
    acceleration: doctor.acceleration,
    window: {
      title: window.title,
      pid: window.pid,
      windowId: window.window_id,
      capture: {
        x: initialCapture.x,
        y: initialCapture.y,
        width: initialCapture.width,
        height: initialCapture.height,
      },
    },
    realWindowCapture: {
      method: initialCapture.method,
      initial: initialCapture.path,
    },
    baselineCapture: baselineCapture.path,
    changedCapture: changedCapture.path,
    prewarm,
    contentRegion,
    dirtyRegion,
    ocrRegion,
    fullWindowOcr: summarizeOcr(fullWindowOcr),
    contentRegionOcr: summarizeOcr(contentRegionOcr),
    dirtyOcr: summarizeOcr(dirtyOcr),
    missing,
    diskText,
    includeUserOverlay: false,
  }, null, 2));
  process.exitCode = statusText === "passed" ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    phase: "0.8",
    benchmark: "real-window-dirty-region-ocr",
    error: error instanceof Error ? error.message : String(error),
    mcpStderr: mcp.stderrText().slice(-4000),
    includeUserOverlay: false,
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (driverSessionStarted) {
    await mcp.callTool("end_session", { session: sessionName }).catch(() => {});
  }
  await ocr.close();
  await mcp.close();
  if (lab && !lab.killed) {
    lab.kill();
  }
  overlay.stop();
  stopGatewayManagedOverlay();
}

async function prewarmOcrBuckets(ocr) {
  const started = performance.now();
  const buckets = [];
  for (const bucket of DEFAULT_OCR_PREWARM_BUCKETS) {
    const before = performance.now();
    const response = await ocr.recognize({
      fixture: "canvas-lab",
      crop: bucket.crop,
      languages: ["zh", "en"],
      timeoutMs: 15000,
      noCache: true,
    });
    buckets.push({
      size: bucket.size,
      crop: bucket.crop,
      totalMs: Math.round((performance.now() - before) * 10) / 10,
      count: response.items.length,
    });
  }
  return {
    status: "completed",
    totalMs: Math.round((performance.now() - started) * 10) / 10,
    buckets,
  };
}

async function waitForWindow(mcp, titlePart) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const windowsResult = await mcp.callTool("list_windows", { on_screen_only: false });
    const windows = structured(windowsResult).windows ?? [];
    const window = windows.find((item) => item.title?.includes(titlePart));
    if (window) return window;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`window.not_found: ${titlePart}`);
}

async function publishOverlayTargetRect(targetRectFile, window) {
  if (!targetRectFile || !window.bounds) return;
  await writeFile(targetRectFile, JSON.stringify({
    windowId: window.window_id,
    x: window.bounds.x,
    y: window.bounds.y,
    width: window.bounds.width,
    height: window.bounds.height,
    title: window.title ?? "",
  }), "utf8");
}

function structured(result) {
  return result.structuredContent ?? result;
}

function nativeLabContentRegion(name, save, capture) {
  const frames = [name.frame, save.frame].filter(Boolean);
  const left = Math.min(...frames.map((frame) => frame.x)) - capture.x - 110;
  const top = Math.min(...frames.map((frame) => frame.y)) - capture.y - 92;
  const right = Math.max(...frames.map((frame) => frame.x + frame.w)) - capture.x + 36;
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.h)) - capture.y + 190;
  const x = clamp(Math.floor(left), 0, capture.width - 1);
  const y = clamp(Math.floor(top), 0, capture.height - 1);
  return {
    x,
    y,
    width: clamp(Math.ceil(right), 0, capture.width) - x,
    height: clamp(Math.ceil(bottom), 0, capture.height) - y,
  };
}

function summarizeOcr(response) {
  return {
    totalMs: response.timings.totalMs,
    crop: response.crop,
    count: response.items.length,
    recognizedText: response.items.map((item) => item.text),
  };
}

function textOf(response) {
  return response.items.map((item) => item.text).join("\n");
}

async function waitForSavedText(filePath, expected) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 3000) {
    try {
      const text = await readFile(filePath, "utf8");
      if (text === expected) return text;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (lastError) throw lastError;
  throw new Error("saved_text.timeout");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      shell: false,
      windowsHide: options.windowsHide ?? true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
