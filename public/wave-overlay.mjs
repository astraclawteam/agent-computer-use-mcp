export const WAVE_THICKNESS = Object.freeze({
  min: 8,
  rest: 12,
  max: 16,
});

const POINT_STEP = 18;
const TAU = Math.PI * 2;
const DEFAULT_WAVE_RGB = "217 119 87";

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

function readWaveTheme(canvas) {
  const root = canvas.ownerDocument?.documentElement;
  const source = root ?? canvas;
  const rgb = normalizeRgb(
    readCssValue(source, "--computer-use-wave-rgb", readCssValue(source, "--clay-rgb", DEFAULT_WAVE_RGB)),
  );
  const fillAlpha = Number(readCssValue(source, "--computer-use-wave-fill-alpha", "0.28"));
  const midAlpha = Number(readCssValue(source, "--computer-use-wave-mid-alpha", "0.12"));
  const currentPrimaryAlpha = Number(readCssValue(source, "--computer-use-wave-current-primary-alpha", "0.28"));
  const currentSecondaryAlpha = Number(readCssValue(source, "--computer-use-wave-current-secondary-alpha", "0.18"));

  return {
    rgb,
    fillAlpha: Number.isFinite(fillAlpha) ? fillAlpha : 0.28,
    midAlpha: Number.isFinite(midAlpha) ? midAlpha : 0.12,
    currentPrimaryAlpha: Number.isFinite(currentPrimaryAlpha) ? currentPrimaryAlpha : 0.28,
    currentSecondaryAlpha: Number.isFinite(currentSecondaryAlpha) ? currentSecondaryAlpha : 0.18,
  };
}

function waveAt(index, time, phase) {
  return (
    Math.sin(index * 0.72 + time * 0.0018 + phase) * 0.55 +
    Math.sin(index * 1.37 - time * 0.0011 + phase * 0.7) * 0.32 +
    Math.sin(index * 2.41 + time * 0.0007 + phase * 1.9) * 0.13
  );
}

function thicknessAt(index, time, phase) {
  const normalized = (waveAt(index, time, phase) + 1) / 2;
  return WAVE_THICKNESS.min + normalized * (WAVE_THICKNESS.max - WAVE_THICKNESS.min);
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
  const corner = WAVE_THICKNESS.max;
  const top = makeEdgePoints(width - corner * 2, (depth) => depth, time, 0.1, true)
    .map(([x, y]) => [x + corner, y]);
  const right = makeEdgePoints(height - corner * 2, (depth) => width - depth, time, 1.4, false)
    .map(([x, y]) => [x, y + corner]);
  const bottom = makeEdgePoints(width - corner * 2, (depth) => height - depth, time, 2.7, true, true)
    .map(([x, y]) => [x + corner, y]);
  const left = makeEdgePoints(height - corner * 2, (depth) => depth, time, 4.1, false, true)
    .map(([x, y]) => [x, y + corner]);

  ctx.beginPath();
  ctx.rect(0, 0, width, height);
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
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([24, 32, 8, 28]);
  ctx.lineDashOffset = -time * 0.045 - phase;
  ctx.beginPath();

  const topY = inset + Math.sin(time * 0.001 + phase) * 1.2;
  ctx.moveTo(0, topY);
  for (let x = 0; x <= width; x += 28) {
    ctx.lineTo(x, topY + Math.sin(x * 0.03 + time * 0.002 + phase) * 1.4);
  }

  const rightX = width - inset + Math.sin(time * 0.0012 + phase) * 1.2;
  ctx.moveTo(rightX, 0);
  for (let y = 0; y <= height; y += 28) {
    ctx.lineTo(rightX + Math.sin(y * 0.03 + time * 0.002 + phase) * 1.4, y);
  }

  const bottomY = height - inset + Math.sin(time * 0.0014 + phase) * 1.2;
  ctx.moveTo(width, bottomY);
  for (let x = width; x >= 0; x -= 28) {
    ctx.lineTo(x, bottomY + Math.sin(x * 0.03 - time * 0.002 + phase) * 1.4);
  }

  const leftX = inset + Math.sin(time * 0.0016 + phase) * 1.2;
  ctx.moveTo(leftX, height);
  for (let y = height; y >= 0; y -= 28) {
    ctx.lineTo(leftX + Math.sin(y * 0.03 - time * 0.002 + phase) * 1.4, y);
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

    createWaveBandPath(ctx, width, height, time);
    ctx.fillStyle = `rgb(${theme.rgb} / ${theme.fillAlpha})`;
    ctx.fill("evenodd");

    ctx.save();
    createWaveBandPath(ctx, width, height, time);
    ctx.clip("evenodd");

    const sheen = ctx.createLinearGradient(0, 0, width, height);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.34)");
    sheen.addColorStop(0.45, `rgb(${theme.rgb} / ${theme.midAlpha})`);
    sheen.addColorStop(1, "rgba(255, 255, 255, 0.24)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, width, height);

    drawCurrent(ctx, width, height, time, WAVE_THICKNESS.min + 2, theme.currentPrimaryAlpha, 0);
    drawCurrent(ctx, width, height, time, WAVE_THICKNESS.rest + 1, theme.currentSecondaryAlpha, TAU / 3);
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
