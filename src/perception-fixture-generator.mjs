import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createCanvas } from "ppu-ocv/canvas";

const LICENSE_BYTES = Buffer.from("MIT License\n\nCopyright (c) 2026 AstraClaw Team\n", "utf8");
const TEXT_CASES = Object.freeze([
  ["chinese", "保存", "dialog"],
  ["chinese", "打开文件", "native-form"],
  ["chinese", "导出时间线", "timeline"],
  ["english", "Save", "editor"],
  ["english", "Open project", "toolbar"],
  ["english", "Apply changes", "dialog"],
  ["numeric", "125.50", "table"],
  ["numeric", "1920 x 1080", "canvas"],
  ["numeric", "00:01:24", "timeline"],
  ["mixed", "轨道 A1", "timeline"],
  ["mixed", "图层 Layer 02", "canvas"],
  ["mixed", "角度 45 deg", "cad"],
]);
const VISUAL_SURFACES = Object.freeze([
  "canvas",
  "timeline",
  "cad-like",
  "toolbar",
  "dialog",
  "table",
  "editor",
]);
const APP_CLASSES = Object.freeze(["native-form", "editor", "table", "timeline", "canvas", "cad", "toolbar", "dialog"]);
const DPIS = Object.freeze([100, 125, 150]);
const THEMES = Object.freeze(["light", "dark"]);

export async function generateQuickCorpus({ outputRoot, seed = 20260713 } = {}) {
  if (!Number.isSafeInteger(seed)) throw generatorError("perception.fixture_seed_invalid");
  if (typeof outputRoot !== "string" || outputRoot.trim() === "") {
    throw generatorError("perception.fixture_output_required");
  }
  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "LICENSE.txt"), LICENSE_BYTES);
  const random = mulberry32(seed >>> 0);
  const samples = [];

  for (let index = 0; index < TEXT_CASES.length; index += 1) {
    const [languageClass, text, applicationClass] = TEXT_CASES[index];
    const id = `quick-ocr-${languageClass}-${String(index).padStart(2, "0")}`;
    const target = `images/${id}.png`;
    const dpi = DPIS[index % DPIS.length];
    const theme = THEMES[index % THEMES.length];
    const image = drawTextRegion({ text, dpi, theme, random, size: textRegionSize(index) });
    const bytes = image.canvas.toBuffer("image/png");
    await writeAsset(root, target, bytes);
    samples.push({
      id,
      kind: "ocr",
      applicationClass,
      dpi,
      theme,
      licenseId: "generated-mit",
      image: identity(target, bytes),
      annotation: {
        normalizedText: text,
        languageClass,
        criticalLabel: index % 3 !== 1,
        region: image.region,
      },
    });
  }

  for (let index = 0; index < VISUAL_SURFACES.length; index += 1) {
    const surfaceClass = VISUAL_SURFACES[index];
    const id = `quick-visual-${surfaceClass}`;
    const target = `images/${id}.png`;
    const dpi = DPIS[index % DPIS.length];
    const theme = THEMES[(index + 1) % THEMES.length];
    const image = drawVisualScene({ surfaceClass, theme, random });
    const bytes = image.canvas.toBuffer("image/png");
    await writeAsset(root, target, bytes);
    samples.push({
      id,
      kind: "visual",
      applicationClass: APP_CLASSES[index % APP_CLASSES.length],
      dpi,
      theme,
      licenseId: "generated-mit",
      image: identity(target, bytes),
      annotation: {
        surfaceClass,
        targets: image.targets,
        ignored: image.ignored,
      },
    });
  }

  const manifest = {
    schemaVersion: 1,
    packId: "agent-computer-use-perception-quick",
    version: `2026.07.13-seed-${seed}`,
    tier: "quick",
    provenance: "generated",
    licenses: [{ id: "generated-mit", spdx: "MIT", ...identity("LICENSE.txt", LICENSE_BYTES) }],
    samples,
  };
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function drawTextRegion({ text, dpi, theme, random, size }) {
  const { width, height } = size;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const dark = theme === "dark";
  ctx.fillStyle = dark ? "#202124" : "#f7f7f4";
  ctx.fillRect(0, 0, width, height);
  const inset = 7 + Math.floor(random() * 5);
  ctx.fillStyle = dark ? "#303136" : "#ffffff";
  ctx.fillRect(inset, 8, width - inset * 2, height - 16);
  ctx.strokeStyle = dark ? "#6d7078" : "#8b8f98";
  ctx.lineWidth = 1 + Math.floor(random() * 2);
  ctx.strokeRect(inset, 8, width - inset * 2, height - 16);
  ctx.fillStyle = dark ? "#f2f3f5" : "#161719";
  ctx.font = `${Math.round(26 * dpi / 100)}px "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(text, inset + 14, height / 2, width - inset * 2 - 28);
  return { canvas, region: { x: 0, y: 0, width, height } };
}

function textRegionSize(index) {
  if (index === 5 || index === 11) return { width: 900, height: 520 };
  if (index === 4 || index === 10) return { width: 680, height: 230 };
  return { width: 360, height: 72 };
}

function drawVisualScene({ surfaceClass, theme, random }) {
  const width = 360;
  const height = 220;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const dark = theme === "dark";
  const background = dark ? "#202124" : "#f4f5f6";
  const panel = dark ? "#33353a" : "#ffffff";
  const ink = dark ? "#f4f5f7" : "#202124";
  const accent = dark ? "#ff9b7c" : "#d9573f";
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = panel;
  ctx.fillRect(14, 14, width - 28, height - 28);
  ctx.strokeStyle = dark ? "#767981" : "#7c8088";
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, width - 28, height - 28);

  const x = 28 + Math.floor(random() * 16);
  const y = 38 + Math.floor(random() * 12);
  const target = { x, y, width: 92, height: 38 };
  ctx.fillStyle = accent;
  ctx.fillRect(target.x, target.y, target.width, target.height);
  ctx.fillStyle = dark ? "#17181a" : "#ffffff";
  ctx.font = "18px Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(surfaceClass === "cad-like" ? "SNAP" : "Apply", target.x + 16, target.y + target.height / 2);

  drawSurfaceDetails(ctx, surfaceClass, { ink, panel, accent, random, width, height });
  const ignoredBox = { x: width - 48, y: 24, width: 16, height: 16 };
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(ignoredBox.x + 8, ignoredBox.y + 8, 5, 0, Math.PI * 2);
  ctx.fill();
  return {
    canvas,
    targets: [{ box: target, role: "button", label: surfaceClass === "cad-like" ? "SNAP" : "Apply", actionable: true }],
    ignored: [{ box: ignoredBox, reason: "decorative-status-dot" }],
  };
}

function drawSurfaceDetails(ctx, surfaceClass, options) {
  const { ink, accent, random, width, height } = options;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2;
  if (surfaceClass === "timeline") {
    for (let row = 0; row < 3; row += 1) {
      ctx.strokeRect(32, 104 + row * 28, width - 64, 18);
      ctx.fillStyle = row === 1 ? accent : ink;
      ctx.fillRect(66 + row * 44, 107 + row * 28, 58 + row * 12, 12);
    }
  } else if (surfaceClass === "cad-like") {
    ctx.beginPath();
    ctx.moveTo(74, height - 36);
    ctx.lineTo(182, 96);
    ctx.lineTo(300, height - 48);
    ctx.stroke();
    ctx.strokeRect(166, 90, 32, 32);
  } else if (surfaceClass === "table") {
    for (let row = 0; row < 4; row += 1) ctx.strokeRect(34, 94 + row * 24, 288, 24);
    for (let column = 1; column < 4; column += 1) {
      ctx.beginPath(); ctx.moveTo(34 + column * 72, 94); ctx.lineTo(34 + column * 72, 190); ctx.stroke();
    }
  } else if (surfaceClass === "editor") {
    for (let row = 0; row < 5; row += 1) ctx.fillRect(44, 98 + row * 19, 120 + Math.floor(random() * 120), 4);
  } else if (surfaceClass === "toolbar") {
    for (let column = 0; column < 6; column += 1) ctx.strokeRect(34 + column * 44, 108, 30, 30);
  } else if (surfaceClass === "dialog") {
    ctx.strokeRect(74, 96, 214, 80);
    ctx.fillRect(92, 116, 150, 5);
    ctx.fillRect(92, 140, 104, 5);
  } else {
    ctx.strokeRect(42, 98, 270, 86);
    ctx.beginPath(); ctx.moveTo(54, 168); ctx.lineTo(118, 116); ctx.lineTo(186, 150); ctx.lineTo(292, 108); ctx.stroke();
  }
}

async function writeAsset(root, target, bytes) {
  const path = join(root, ...target.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function identity(target, bytes) {
  return { target, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function generatorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
