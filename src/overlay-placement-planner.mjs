import { WAVE_THICKNESS } from "../public/wave-overlay.mjs";

export function planOverlayPlacement(options = {}) {
  const targetWindow = normalizeTargetWindow(options.targetWindow);
  const displays = normalizeDisplays(options.displays);
  const display = chooseDisplay(targetWindow.bounds, displays);
  const base = {
    display,
    overlayBounds: display.bounds,
    logicalWaveThickness: WAVE_THICKNESS,
    physicalWaveThickness: scaleThickness(WAVE_THICKNESS, display.scaleFactor),
    devicePixelRatio: display.scaleFactor,
    includeUserOverlay: false,
    startsDesktopControl: false,
    capturePolicy: {
      includeUserOverlay: false,
      excludeOverlayBeforeCapture: true,
    },
    topMostPolicy: {
      noActivate: true,
      clickThrough: true,
      showInTaskbar: false,
    },
  };

  if (targetWindow.state === "minimized") {
    return {
      ...base,
      status: "suspended",
      reason: "target-window-minimized",
      visible: false,
      windowMode: "minimized",
      targetFrame: null,
    };
  }

  if (targetWindow.visible === false) {
    return {
      ...base,
      status: "suspended",
      reason: "target-window-hidden",
      visible: false,
      windowMode: "hidden",
      targetFrame: null,
    };
  }

  if (targetWindow.occluded === true) {
    return {
      ...base,
      status: "degraded",
      reason: "target-window-occluded",
      visible: true,
      windowMode: windowMode(targetWindow),
      targetFrame: null,
    };
  }

  return {
    ...base,
    status: "visible",
    reason: "target-window-visible",
    visible: true,
    windowMode: windowMode(targetWindow),
    targetFrame: toDisplayRelativeFrame(targetWindow.bounds, display.bounds),
  };
}

function normalizeTargetWindow(targetWindow = {}) {
  return {
    id: String(targetWindow.id ?? targetWindow.windowId ?? targetWindow.window_id ?? "unknown-window"),
    title: String(targetWindow.title ?? ""),
    bounds: normalizeRect(targetWindow.bounds ?? targetWindow.frame ?? {}),
    state: String(targetWindow.state ?? "normal"),
    visible: targetWindow.visible !== false,
    occluded: targetWindow.occluded === true,
    borderless: targetWindow.borderless === true,
  };
}

function normalizeDisplays(displays = []) {
  const normalized = displays.map((display, index) => ({
    id: String(display.id ?? display.name ?? `display-${index + 1}`),
    bounds: normalizeRect(display.bounds ?? display.workArea ?? {}),
    workArea: display.workArea ? normalizeRect(display.workArea) : null,
    scaleFactor: normalizeScale(display.scaleFactor ?? display.dpiScale ?? display.devicePixelRatio),
  })).filter((display) => display.bounds.width > 0 && display.bounds.height > 0);

  if (normalized.length > 0) return normalized;
  return [{
    id: "primary",
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    workArea: null,
    scaleFactor: 1,
  }];
}

function normalizeRect(rect = {}) {
  const x = Number(rect.x ?? rect.left ?? 0);
  const y = Number(rect.y ?? rect.top ?? 0);
  const width = Number(rect.width ?? rect.w ?? Math.max(0, Number(rect.right ?? 0) - x));
  const height = Number(rect.height ?? rect.h ?? Math.max(0, Number(rect.bottom ?? 0) - y));
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? Math.max(0, width) : 0,
    height: Number.isFinite(height) ? Math.max(0, height) : 0,
  };
}

function normalizeScale(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.round(value * 1000) / 1000;
}

function chooseDisplay(targetBounds, displays) {
  return displays
    .map((display) => ({
      display,
      area: intersectionArea(targetBounds, display.bounds),
    }))
    .sort((left, right) => right.area - left.area)[0]?.display ?? displays[0];
}

function intersectionArea(left, right) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function toDisplayRelativeFrame(windowBounds, displayBounds) {
  const left = clamp(windowBounds.x, displayBounds.x, displayBounds.x + displayBounds.width);
  const top = clamp(windowBounds.y, displayBounds.y, displayBounds.y + displayBounds.height);
  const right = clamp(windowBounds.x + windowBounds.width, displayBounds.x, displayBounds.x + displayBounds.width);
  const bottom = clamp(windowBounds.y + windowBounds.height, displayBounds.y, displayBounds.y + displayBounds.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width < 1 || height < 1) return null;
  return {
    x: round(left - displayBounds.x),
    y: round(top - displayBounds.y),
    width: round(width),
    height: round(height),
  };
}

function windowMode(targetWindow) {
  if (targetWindow.state === "fullscreen" && targetWindow.borderless) return "fullscreen-borderless";
  if (targetWindow.state === "fullscreen") return "fullscreen";
  if (targetWindow.borderless) return "borderless";
  return targetWindow.state || "normal";
}

function scaleThickness(thickness, scaleFactor) {
  return {
    min: round(thickness.min * scaleFactor),
    rest: round(thickness.rest * scaleFactor),
    max: round(thickness.max * scaleFactor),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
