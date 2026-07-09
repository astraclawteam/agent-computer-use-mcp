import { createCanvas, loadImage } from "ppu-ocv";

export async function matchTemplateFile(options = {}) {
  const image = await readPixels(options.imagePath);
  const templates = options.templates ?? [];
  const allMatches = [];

  for (const template of templates) {
    const templatePixels = await readPixels(template.path);
    const threshold = template.threshold ?? 0.96;
    const candidates = matchTemplatePixels(image, templatePixels, {
      ...template,
      threshold,
      maxMatches: template.maxMatches ?? options.maxMatches ?? 20,
    });
    allMatches.push(...candidates);
  }

  const matches = suppressOverlappingMatches(
    allMatches.sort((left, right) => right.score - left.score),
    options.overlapThreshold ?? 0.4,
  );

  return {
    status: matches.length > 0 ? "matched" : "insufficient",
    reason: matches.length > 0
      ? "template-matches-found"
      : "observation.insufficient: no template matches above threshold",
    provider: "template",
    matches,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function normalizeTemplateMatches(result, options = {}) {
  const elements = (result.matches ?? []).map((match, index) => ({
    elementToken: `template-${index + 1}`,
    elementIndex: index,
    role: match.role,
    name: match.label,
    value: match.label,
    state: {},
    actions: ["click"],
    bounds: match.bounds,
    confidence: match.score,
    source: "template",
    templateId: match.templateId,
    pixelLimitedAction: true,
  }));

  return {
    observationId: options.observationId ?? `template-obs-${Date.now()}`,
    provider: "gateway-managed",
    source: "template",
    mode: "template",
    window: options.window,
    elements,
    text: elements.map((element) => element.name).join("\n"),
    includeUserOverlay: false,
  };
}

function matchTemplatePixels(image, template, options) {
  if (template.width > image.width || template.height > image.height) {
    return [];
  }

  const matches = [];

  for (let y = 0; y <= image.height - template.height; y += 1) {
    for (let x = 0; x <= image.width - template.width; x += 1) {
      const score = scoreTemplateAt({
        imageData: image.data,
        imageWidth: image.width,
        templateData: template.data,
        templateWidth: template.width,
        templateHeight: template.height,
        x,
        y,
      });
      if (score >= options.threshold) {
        matches.push({
          templateId: options.id,
          label: options.label ?? options.id,
          role: options.role ?? "button",
          score,
          bounds: {
            x,
            y,
            width: template.width,
            height: template.height,
          },
          source: "template",
          pixelLimitedAction: true,
        });
      }
    }
  }

  return matches
    .sort((left, right) => right.score - left.score)
    .slice(0, options.maxMatches);
}

function scoreTemplateAt({ imageData, imageWidth, templateData, templateWidth, templateHeight, x, y }) {
  let totalDelta = 0;
  let channelCount = 0;
  for (let ty = 0; ty < templateHeight; ty += 1) {
    for (let tx = 0; tx < templateWidth; tx += 1) {
      const imageOffset = ((y + ty) * imageWidth + (x + tx)) * 4;
      const templateOffset = (ty * templateWidth + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        totalDelta += Math.abs((imageData[imageOffset + channel] ?? 0) - (templateData[templateOffset + channel] ?? 0));
        channelCount += 1;
      }
    }
  }
  const meanDelta = totalDelta / (channelCount * 255);
  return roundScore(1 - meanDelta);
}

function suppressOverlappingMatches(matches, overlapThreshold) {
  const kept = [];
  for (const match of matches) {
    if (kept.some((existing) => intersectionOverUnion(existing.bounds, match.bounds) > overlapThreshold)) {
      continue;
    }
    kept.push(match);
  }
  return kept.sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
}

function intersectionOverUnion(left, right) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (intersection === 0) return 0;
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  return intersection / (leftArea + rightArea - intersection);
}

async function readPixels(path) {
  if (!path) throw new Error("template_matching_provider.path_required");
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

function roundScore(value) {
  return Math.round(value * 1000000) / 1000000;
}
