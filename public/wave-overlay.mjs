export const WAVE_THICKNESS = Object.freeze({
  min: 24,
  rest: 36,
  max: 48,
});

export const WAVE_BREATH_PERIOD_MS = 3200;
export const WAVE_ALPHA = Object.freeze({
  min: 0.24,
  max: 0.50,
});
export const WAVE_FILL_MIX = Object.freeze({
  clay: 0.72,
  deep: 0.16,
  soft: 0.12,
});

const POINT_STEP = 18;
const TAU = Math.PI * 2;
const DEFAULT_WAVE_RGB = "217 119 87";
const DEFAULT_WAVE_DEEP_RGB = "184 89 59";
const DEFAULT_WAVE_SOFT_RGB = "247 210 195";

function readCssValue(element, name, fallback) {
  const ownerWindow = element?.ownerDocument?.defaultView;
  if (!ownerWindow) return fallback;
  const value = ownerWindow.getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

function normalizeRgb(value) {
  const parts = value
    .replaceAll(",", " ")
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  if (parts.length < 3) return DEFAULT_WAVE_RGB;
  return parts.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(part)))).join(" ");
}

export function mixWaveFillRgb(clayRgb, deepRgb, softRgb) {
  const colors = [clayRgb, deepRgb, softRgb].map((value) => normalizeRgb(value).split(" ").map(Number));
  return colors[0].map((clay, channel) => Math.round(
    clay * WAVE_FILL_MIX.clay
      + colors[1][channel] * WAVE_FILL_MIX.deep
      + colors[2][channel] * WAVE_FILL_MIX.soft,
  )).join(" ");
}

function readWaveTheme(canvas) {
  const root = canvas.ownerDocument?.documentElement;
  const source = root ?? canvas;
  const rgb = normalizeRgb(
    readCssValue(source, "--computer-use-wave-rgb", readCssValue(source, "--clay-rgb", DEFAULT_WAVE_RGB)),
  );
  const deepRgb = normalizeRgb(
    readCssValue(source, "--computer-use-wave-deep-rgb", readCssValue(source, "--clay-deep-rgb", DEFAULT_WAVE_DEEP_RGB)),
  );
  const softRgb = normalizeRgb(
    readCssValue(source, "--computer-use-wave-soft-rgb", readCssValue(source, "--clay-soft-rgb", DEFAULT_WAVE_SOFT_RGB)),
  );
  const minAlpha = Number(readCssValue(source, "--computer-use-wave-min-alpha", String(WAVE_ALPHA.min)));
  const maxAlpha = Number(readCssValue(source, "--computer-use-wave-max-alpha", String(WAVE_ALPHA.max)));

  return {
    rgb,
    deepRgb,
    softRgb,
    fillRgb: mixWaveFillRgb(rgb, deepRgb, softRgb),
    minAlpha: Number.isFinite(minAlpha) ? minAlpha : WAVE_ALPHA.min,
    maxAlpha: Number.isFinite(maxAlpha) ? maxAlpha : WAVE_ALPHA.max,
  };
}

function phaseAt(time) {
  const elapsedInPeriod = time % WAVE_BREATH_PERIOD_MS;
  return (elapsedInPeriod + WAVE_BREATH_PERIOD_MS) % WAVE_BREATH_PERIOD_MS / WAVE_BREATH_PERIOD_MS;
}

function breathAt(time) {
  const phase = phaseAt(time);
  return 0.5 - 0.5 * Math.cos(TAU * phase);
}

function waveAt(index, time, phase) {
  const cycleRadians = phaseAt(time) * TAU;
  return (
    Math.sin(index * 0.72 + cycleRadians + phase) * 0.55 +
    Math.sin(index * 1.37 - cycleRadians * 0.61 + phase * 0.7) * 0.32 +
    Math.sin(index * 2.41 + cycleRadians * 0.39 + phase * 1.9) * 0.13
  );
}

function thicknessAt(index, time, phase) {
  const baseThickness = 30 + (42 - 30) * breathAt(time);
  return Math.max(
    WAVE_THICKNESS.min,
    Math.min(WAVE_THICKNESS.max, baseThickness + waveAt(index, time, phase) * 6),
  );
}

function makeEdgePoints(length, fixedCoordinate, time, phase, horizontal, reverse = false) {
  const count = Math.max(8, Math.ceil(length / POINT_STEP));
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const travel = reverse ? 1 - t : t;
    const along = travel * length;
    const depth = thicknessAt(i, time, phase);
    points.push(horizontal ? [along, fixedCoordinate(depth)] : [fixedCoordinate(depth), along]);
  }
  return points;
}

export function createWaveBandPath(ctx, width, height, time) {
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  traceInnerBoundary(ctx, width, height, time);
}

function createInnerBoundaryPath(ctx, width, height, time) {
  ctx.beginPath();
  traceInnerBoundary(ctx, width, height, time);
}

function traceInnerBoundary(ctx, width, height, time) {
  const corner = WAVE_THICKNESS.max;
  const top = makeEdgePoints(width - corner * 2, (depth) => depth, time, 0.1, true)
    .map(([x, y]) => [x + corner, y]);
  const right = makeEdgePoints(height - corner * 2, (depth) => width - depth, time, 1.4, false)
    .map(([x, y]) => [x, y + corner]);
  const bottom = makeEdgePoints(width - corner * 2, (depth) => height - depth, time, 2.7, true, true)
    .map(([x, y]) => [x + corner, y]);
  const left = makeEdgePoints(height - corner * 2, (depth) => depth, time, 4.1, false, true)
    .map(([x, y]) => [x, y + corner]);

  ctx.moveTo(top[0][0], top[0][1]);
  for (const [x, y] of top) ctx.lineTo(x, y);
  ctx.quadraticCurveTo(width - corner * 0.35, corner * 0.35, right[0][0], right[0][1]);
  for (const [x, y] of right) ctx.lineTo(x, y);
  ctx.quadraticCurveTo(width - corner * 0.35, height - corner * 0.35, bottom[0][0], bottom[0][1]);
  for (const [x, y] of bottom) ctx.lineTo(x, y);
  ctx.quadraticCurveTo(corner * 0.35, height - corner * 0.35, left[0][0], left[0][1]);
  for (const [x, y] of left) ctx.lineTo(x, y);
  ctx.quadraticCurveTo(corner * 0.35, corner * 0.35, top[0][0], top[0][1]);
  ctx.closePath();
}

function drawCurrent(ctx, width, height, time, inset, alpha, phase) {
  const cycleRadians = phaseAt(time) * TAU;
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([24, 32, 8, 28]);
  ctx.lineDashOffset = -phaseAt(time) * 44 - phase;
  ctx.beginPath();

  const topY = inset + Math.sin(cycleRadians + phase) * 1.2;
  ctx.moveTo(0, topY);
  for (let x = 0; x <= width; x += 28) {
    ctx.lineTo(x, topY + Math.sin(x * 0.03 + cycleRadians + phase) * 1.4);
  }

  const rightX = width - inset + Math.sin(cycleRadians + phase) * 1.2;
  ctx.moveTo(rightX, 0);
  for (let y = 0; y <= height; y += 28) {
    ctx.lineTo(rightX + Math.sin(y * 0.03 + cycleRadians + phase) * 1.4, y);
  }

  const bottomY = height - inset + Math.sin(cycleRadians + phase) * 1.2;
  ctx.moveTo(width, bottomY);
  for (let x = width; x >= 0; x -= 28) {
    ctx.lineTo(x, bottomY + Math.sin(x * 0.03 - cycleRadians + phase) * 1.4);
  }

  const leftX = inset + Math.sin(cycleRadians + phase) * 1.2;
  ctx.moveTo(leftX, height);
  for (let y = height; y >= 0; y -= 28) {
    ctx.lineTo(leftX + Math.sin(y * 0.03 - cycleRadians + phase) * 1.4, y);
  }

  ctx.stroke();
  ctx.restore();
}

function resizeCanvas(canvas) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  return { width, height, ratio };
}

export function createWaveOverlay(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let frame = 0;
  let running = false;

  function draw(time = performance.now()) {
    const { width, height, ratio } = resizeCanvas(canvas);
    const theme = readWaveTheme(canvas);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const breath = breathAt(time);
    const fillAlpha = theme.minAlpha + (theme.maxAlpha - theme.minAlpha) * breath;
    const baseThickness = 30 + (42 - 30) * breath;

    createWaveBandPath(ctx, width, height, time);
    ctx.fillStyle = `rgb(${theme.fillRgb} / ${fillAlpha})`;
    ctx.fill("evenodd");

    createInnerBoundaryPath(ctx, width, height, time);
    ctx.strokeStyle = `rgb(${theme.deepRgb} / ${fillAlpha * 0.62})`;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.save();
    createWaveBandPath(ctx, width, height, time);
    ctx.clip("evenodd");

    drawCurrent(ctx, width, height, time, Math.max(WAVE_THICKNESS.min, baseThickness - 3), fillAlpha * 0.2, 0);
    drawCurrent(ctx, width, height, time, Math.max(WAVE_THICKNESS.min, baseThickness - 1), fillAlpha * 0.12, TAU / 3);
    ctx.restore();

    if (running) {
      frame = requestAnimationFrame(draw);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      draw();
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    draw,
  };
}
