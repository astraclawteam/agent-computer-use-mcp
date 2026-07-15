import { createCanvas, loadImage } from "ppu-ocv";

export async function proposeSomFromImageFile(options = {}) {
  const image = await readPixels(options.imagePath);
  const minArea = options.minArea ?? 96;
  const maxProposals = options.maxProposals ?? 32;
  const components = findComponents(image, {
    threshold: options.threshold ?? 24,
    minArea,
  });
  const proposals = components
    .map((component, index) => ({
      proposalId: `som-proposal-${index + 1}`,
      role: inferRole(component),
      label: inferLabel(component, index),
      bounds: {
        x: component.x,
        y: component.y,
        width: component.width,
        height: component.height,
      },
      confidence: scoreComponent(component),
      rawConfidence: scoreComponent(component),
      calibrationVersion: "som-geometry-v1",
      source: "som-proposal",
      pixelLimitedAction: true,
      actions: ["click"],
      area: component.area,
    }))
    .filter((proposal) => proposal.confidence >= (options.minConfidence ?? 0.7))
    .slice(0, maxProposals);

  return {
    status: proposals.length > 0 ? "proposed" : "insufficient",
    reason: proposals.length > 0
      ? "som-proposals-found"
      : "observation.insufficient: no safe SOM proposals",
    provider: "som-proposal",
    surface: options.surface ?? "unknown",
    proposals,
    uploadsImage: false,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function normalizeSomProposals(result, options = {}) {
  const elements = (result.proposals ?? []).map((proposal, index) => ({
    elementToken: `som-proposal-${index + 1}`,
    elementIndex: index,
    role: proposal.role,
    name: proposal.label,
    value: proposal.label,
    state: {},
    actions: proposal.actions ?? ["click"],
    bounds: proposal.bounds,
    confidence: proposal.confidence,
    source: "som-proposal",
    proposalId: proposal.proposalId,
    pixelLimitedAction: true,
  }));

  return {
    observationId: options.observationId ?? `som-proposal-obs-${Date.now()}`,
    provider: "gateway-managed",
    source: "som-proposal",
    mode: "som-proposal",
    window: options.window,
    surface: result.surface,
    elements,
    text: elements.map((element) => element.name).join("\n"),
    includeUserOverlay: false,
  };
}

function findComponents(image, options) {
  const foreground = buildForegroundMask(image, options.threshold);
  const visited = new Uint8Array(image.width * image.height);
  const components = [];

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      if (!foreground[index] || visited[index]) continue;
      const component = floodFill({ x, y, image, foreground, visited });
      if (component.area >= options.minArea) {
        components.push(component);
      }
    }
  }

  return components.sort((left, right) => left.y - right.y || left.x - right.x);
}

function buildForegroundMask(image, threshold) {
  const mask = new Uint8Array(image.width * image.height);
  const background = sampleBackground(image);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const delta = Math.max(
        Math.abs((image.data[offset] ?? 0) - background.r),
        Math.abs((image.data[offset + 1] ?? 0) - background.g),
        Math.abs((image.data[offset + 2] ?? 0) - background.b),
      );
      if (delta >= threshold) mask[y * image.width + x] = 1;
    }
  }
  return mask;
}

function floodFill({ x, y, image, foreground, visited }) {
  const stack = [{ x, y }];
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;
  let area = 0;
  while (stack.length > 0) {
    const point = stack.pop();
    const index = point.y * image.width + point.x;
    if (visited[index] || !foreground[index]) continue;
    visited[index] = 1;
    area += 1;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    for (const next of neighbors(point, image)) {
      const nextIndex = next.y * image.width + next.x;
      if (!visited[nextIndex] && foreground[nextIndex]) stack.push(next);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area,
  };
}

function neighbors(point, image) {
  const items = [];
  if (point.x > 0) items.push({ x: point.x - 1, y: point.y });
  if (point.x < image.width - 1) items.push({ x: point.x + 1, y: point.y });
  if (point.y > 0) items.push({ x: point.x, y: point.y - 1 });
  if (point.y < image.height - 1) items.push({ x: point.x, y: point.y + 1 });
  return items;
}

function inferRole(component) {
  const aspect = component.width / Math.max(1, component.height);
  if (component.height >= 14 && aspect >= 1.4 && aspect <= 3.5) return "button";
  return "region";
}

function inferLabel(component, index) {
  return inferRole(component) === "button"
    ? `Button proposal ${index + 1}`
    : `Region proposal ${index + 1}`;
}

function scoreComponent(component) {
  const fillRatio = component.area / (component.width * component.height);
  const sizeScore = Math.min(1, component.area / 240);
  const confidence = 0.55 + Math.min(0.4, fillRatio * 0.25 + sizeScore * 0.15);
  return Math.round(confidence * 1000000) / 1000000;
}

function sampleBackground(image) {
  return {
    r: image.data[0] ?? 255,
    g: image.data[1] ?? 255,
    b: image.data[2] ?? 255,
  };
}

async function readPixels(path) {
  if (!path) throw new Error("som_proposal_provider.path_required");
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const imageData = context.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    data: imageData.data,
  };
}
