import { proposeSomFromImageFile } from "./som-proposal-provider.mjs";
import { normalizeRecognizedUiText } from "./ui-text-normalization.mjs";
import { createCanvas, loadImage } from "ppu-ocv";

const SEARCH_LABELS = new Set(["search", "find", "搜索", "查找"]);
const VISUAL_THRESHOLDS = Object.freeze([8, 24]);

export function stableCompositionOcrElements({
  currentElements = [],
  previousElements = [],
  visualSceneStable = false,
} = {}) {
  const current = currentElements.filter(isOcrElement);
  if (!visualSceneStable) return current;
  const merged = [...current];
  for (const previous of previousElements.filter(isOcrElement)) {
    const duplicate = merged.some((candidate) => sameOcrOccurrence(candidate, previous));
    if (!duplicate) merged.push(previous);
  }
  return merged;
}

export async function detectMessagingVisualProposals({
  imagePath,
  ocrElements = [],
  propose = proposeSomFromImageFile,
} = {}) {
  if (typeof imagePath !== "string" || imagePath.length === 0) return [];
  const observations = await Promise.all(VISUAL_THRESHOLDS.map((threshold) => propose({
    imagePath,
    surface: "self-drawn",
    threshold,
    minArea: 80,
    maxProposals: 128,
    minConfidence: 0.7,
  })));
  const pixels = await readPixels(imagePath);
  const semanticSurfaces = ocrElements.flatMap((element, index) => {
    if (!isOcrElement(element) || semanticControlRole(elementText(element)) === null) return [];
    const surface = detectControlSurfaceFromPixels(pixels, element.bounds);
    if (!surface) return [];
    return [{
      proposalId: `semantic-surface-${index + 1}`,
      role: "region",
      bounds: surface,
      confidence: 0.94,
      source: "som-proposal",
      pixelLimitedAction: true,
      guessedAction: false,
    }];
  });
  const proposals = [
    ...observations.flatMap((observation) => observation?.proposals ?? []),
    ...semanticSurfaces,
  ];
  const deduplicated = deduplicateVisualProposals(proposals);
  Object.defineProperty(deduplicated, "diagnostics", {
    value: Object.freeze({
      somProposalCount: proposals.length - semanticSurfaces.length,
      semanticSurfaceCount: semanticSurfaces.length,
      retainedSemanticSurfaceCount: deduplicated.filter(isSemanticSurface).length,
    }),
    enumerable: false,
  });
  return deduplicated;
}

export function detectControlSurfaceFromPixels(image, textBounds, { tolerance = 6 } = {}) {
  if (!isPixelImage(image) || !isBox(textBounds)) return null;
  const centerY = Math.floor(textBounds.y + (textBounds.height / 2));
  const rowCandidates = [...new Set([
    -3, -2, -1, 0,
    textBounds.height - 1,
    textBounds.height, textBounds.height + 1, textBounds.height + 2, textBounds.height + 3,
  ].map((offset) => Math.max(
    0,
    Math.min(image.height - 1, Math.floor(textBounds.y + offset)),
  )))];
  const seedCandidates = [
    Math.max(0, Math.floor(textBounds.x - 6)),
    Math.min(image.width - 1, Math.ceil(textBounds.x + textBounds.width + 6)),
  ];
  const horizontalCandidates = rowCandidates.flatMap((y) => seedCandidates.map((x) => (
    scanHorizontal(image, x, y, tolerance)
  ))).filter((segment) => segment.x <= textBounds.x
    && segment.x + segment.width >= textBounds.x + textBounds.width
    && segment.width <= Math.min(image.width * 0.6, textBounds.width * 12));
  const outline = detectOutlinedSurface(horizontalCandidates, textBounds, image);
  if (outline) return outline;
  const horizontal = horizontalCandidates.sort((left, right) => left.width - right.width)[0];
  if (!horizontal) return null;

  const verticalSeeds = [
    Math.max(horizontal.x, Math.floor(textBounds.x - 8)),
    Math.min(horizontal.x + horizontal.width - 1, Math.ceil(textBounds.x + textBounds.width + 8)),
  ];
  const vertical = verticalSeeds.map((x) => scanVertical(image, x, centerY, tolerance))
    .filter((segment) => segment.y <= textBounds.y
      && segment.y + segment.height >= textBounds.y + textBounds.height)
    .sort((left, right) => right.height - left.height)[0];
  if (!vertical) return null;

  const candidate = {
    x: horizontal.x,
    y: vertical.y,
    width: horizontal.width,
    height: vertical.height,
  };
  const horizontalPadding = candidate.width - textBounds.width;
  const verticalPadding = candidate.height - textBounds.height;
  const areaRatio = area(candidate) / area(textBounds);
  if (!contains(candidate, textBounds)
    || horizontalPadding < 8 || verticalPadding < 3
    || candidate.width > Math.min(image.width * 0.6, textBounds.width * 12)
    || candidate.height > Math.min(image.height * 0.5, Math.max(80, textBounds.height * 4))
    || areaRatio > 80) return null;
  return candidate;
}

function detectOutlinedSurface(segments, textBounds, image) {
  const top = segments
    .filter((segment) => segment.y < textBounds.y)
    .sort((left, right) => right.y - left.y || left.width - right.width)[0];
  const bottom = segments
    .filter((segment) => segment.y >= textBounds.y + textBounds.height - 1)
    .sort((left, right) => left.y - right.y || left.width - right.width)[0];
  if (!top || !bottom || bottom.y <= top.y) return null;
  const left = Math.max(top.x, bottom.x);
  const right = Math.min(top.x + top.width, bottom.x + bottom.width);
  const candidate = {
    x: left,
    y: top.y,
    width: right - left,
    height: bottom.y - top.y + 1,
  };
  if (!isBox(candidate) || !contains(candidate, textBounds)) return null;
  const horizontalPadding = candidate.width - textBounds.width;
  const verticalPadding = candidate.height - textBounds.height;
  const areaRatio = area(candidate) / area(textBounds);
  const interiorColor = pixelAt(
    image,
    Math.floor(candidate.x + candidate.width / 2),
    Math.floor(candidate.y + candidate.height / 2),
  );
  if (horizontalPadding < 8 || verticalPadding < 1
    || candidate.width > Math.min(image.width * 0.6, textBounds.width * 12)
    || candidate.height > Math.min(image.height * 0.5, Math.max(80, textBounds.height * 4))
    || horizontalOverlapBySmallerWidth(top, bottom) < 0.8
    || colorDistance(top.color, interiorColor) <= 12
    || colorDistance(bottom.color, interiorColor) <= 12
    || areaRatio > 80) return null;
  return candidate;
}

function colorDistance(left, right) {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
  );
}

function horizontalOverlapBySmallerWidth(left, right) {
  const overlap = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  return overlap / Math.min(left.width, right.width);
}

export function composeMessagingSceneElements({
  coordinateBounds,
  ocrElements = [],
  visualProposals = [],
  knownControls = [],
  focusedTarget = null,
} = {}) {
  if (!isBox(coordinateBounds)) return frozenResult([], [], {
    ocrCount: 0,
    visualProposalCount: 0,
    semanticControlLabelCount: 0,
    matchedControlCount: 0,
    conflictCount: 0,
  });
  const ocr = ocrElements.filter(isOcrElement);
  const visual = visualProposals.filter((proposal) => isBox(proposal?.bounds));
  const elements = [];
  const nextKnownControls = [];
  const consumedOcr = new Set();
  let conflictCount = 0;

  for (const control of normalizeKnownControls(knownControls, coordinateBounds)) {
    const owners = visualOwnersForKnownControl(control, visual);
    if (owners.length === 0) continue;
    const text = ocr.filter((element) => contains(owners[0].bounds, element.bounds));
    const conflict = materiallyDifferentOwners(owners);
    if (conflict) conflictCount += 1;
    const composition = searchComposition({
      ocr: text[0] ?? null,
      owners,
      conflict,
      value: text.map(elementText).filter(Boolean).join(" "),
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push(composition.knownControl);
    for (const item of text) consumedOcr.add(item);
  }

  for (const item of ocr) {
    if (consumedOcr.has(item) || semanticControlRole(elementText(item)) !== "search") continue;
    const owners = visualOwnersForOcr(item, visual);
    if (owners.length === 0) continue;
    const conflict = materiallyDifferentOwners(owners);
    if (conflict) conflictCount += 1;
    const composition = searchComposition({
      ocr: item,
      owners,
      conflict,
      value: "",
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push(composition.knownControl);
  }

  return frozenResult(elements, uniqueKnownControls(nextKnownControls), {
    ocrCount: ocr.length,
    visualProposalCount: visual.length,
    semanticControlLabelCount: ocr.filter((item) => semanticControlRole(elementText(item)) !== null).length,
    matchedControlCount: elements.filter((element) => element.role === "search").length,
    conflictCount,
  });
}

function searchComposition({ ocr, owners, conflict, value, focusedTarget }) {
  const owner = [...owners].sort(compareArea)[0];
  const bounds = { ...owner.bounds };
  const support = independentSupport(owner, ocr);
  const confidence = complementConfidence(support.map((entry) => entry.confidence));
  const parentToken = `local-search-container:${stableBoxId(bounds)}`;
  const elementToken = `local-search:${stableBoxId(bounds)}`;
  const common = {
    bounds,
    sourceRegion: bounds,
    confidence,
    source: "local-proposal-fusion",
    modelIdentity: { provider: "local-proposal-fusion", model: "som-ocr-role-v1" },
    support,
    proposalId: `messaging-search:${stableBoxId(bounds)}`,
    pixelLimitedAction: true,
    guessedAction: false,
    ...(conflict ? { evidenceConsistency: "conflict", conflicts: ["bounds"] } : {}),
  };
  return {
    elements: [{
      ...common,
      elementToken: parentToken,
      role: "search-container",
      actions: [],
      name: "Search controls",
      value: null,
    }, {
      ...common,
      elementToken,
      parentElementToken: parentToken,
      role: "search",
      actions: conflict ? [] : ["click", "type_text"],
      name: "Search",
      value,
      semanticKey: "control:search",
      state: { focused: targetOverlapsBounds(focusedTarget, bounds) },
    }],
    knownControl: {
      role: "search",
      bounds,
      semanticKey: "control:search",
    },
  };
}

function visualOwnersForOcr(ocr, visual) {
  return visual.filter((proposal) => {
    if (!contains(proposal.bounds, ocr.bounds)) return false;
    const horizontalPadding = proposal.bounds.width - ocr.bounds.width;
    const verticalPadding = proposal.bounds.height - ocr.bounds.height;
    const areaRatio = area(proposal.bounds) / area(ocr.bounds);
    const minimumVerticalPadding = isSemanticSurface(proposal) ? 1 : 3;
    return horizontalPadding >= 8
      && verticalPadding >= minimumVerticalPadding
      && areaRatio <= 80;
  });
}

function visualOwnersForKnownControl(control, visual) {
  const ranked = visual
    .filter((proposal) => overlapBySmallerArea(control.bounds, proposal.bounds) >= 0.75)
    .map((proposal) => ({
      proposal,
      score: intersectionOverUnion(control.bounds, proposal.bounds),
    }))
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return [];
  const bestScore = ranked[0].score;
  return ranked
    .filter((candidate) => bestScore - candidate.score <= 0.05)
    .map((candidate) => candidate.proposal);
}

function materiallyDifferentOwners(owners) {
  if (owners.length < 2) return false;
  const sorted = [...owners].sort(compareArea);
  return sorted.slice(1).some((owner) => intersectionOverUnion(sorted[0].bounds, owner.bounds) < 0.8);
}

function independentSupport(owner, ocr) {
  return [{
    provider: "som-proposal",
    confidence: finiteConfidence(owner.confidence, 0.7),
    proposalId: String(owner.proposalId ?? `visual:${stableBoxId(owner.bounds)}`),
  }, {
    provider: "ocr",
    confidence: finiteConfidence(ocr?.confidence, 0.9),
    proposalId: String(ocr?.proposalId ?? ocr?.elementToken ?? "ocr-owned-label"),
  }];
}

function normalizeKnownControls(controls, coordinateBounds) {
  if (!Array.isArray(controls)) return [];
  return controls.filter((control) => control?.role === "search"
    && isBox(control.bounds) && contains(coordinateBounds, control.bounds));
}

function uniqueKnownControls(controls) {
  const byRole = new Map();
  for (const control of controls) byRole.set(control.role, control);
  return [...byRole.values()].map((control) => Object.freeze({
    ...control,
    bounds: Object.freeze({ ...control.bounds }),
  }));
}

export function deduplicateVisualProposals(proposals) {
  const kept = [];
  for (const proposal of proposals.filter((entry) => isBox(entry?.bounds)).sort(compareArea)) {
    const duplicateIndex = kept.findIndex(
      (entry) => intersectionOverUnion(entry.bounds, proposal.bounds) >= 0.9,
    );
    if (duplicateIndex < 0) {
      kept.push(proposal);
    } else if (isSemanticSurface(proposal) && !isSemanticSurface(kept[duplicateIndex])) {
      kept[duplicateIndex] = proposal;
    }
  }
  return kept;
}

function isSemanticSurface(proposal) {
  return typeof proposal?.proposalId === "string"
    && proposal.proposalId.startsWith("semantic-surface-");
}

function semanticControlRole(value) {
  const normalized = normalizeRecognizedUiText(String(value ?? ""), { languageClass: "mixed" })
    .toLocaleLowerCase();
  return SEARCH_LABELS.has(normalized) ? "search" : null;
}

function isOcrElement(element) {
  return element?.source === "ocr" && isBox(element.bounds) && elementText(element).length > 0;
}

function elementText(element) {
  return typeof element?.name === "string"
    ? element.name
    : typeof element?.value === "string"
      ? element.value
      : "";
}

function sameOcrOccurrence(left, right) {
  const leftText = normalizeRecognizedUiText(elementText(left), { languageClass: "mixed" })
    .toLocaleLowerCase();
  const rightText = normalizeRecognizedUiText(elementText(right), { languageClass: "mixed" })
    .toLocaleLowerCase();
  return leftText.length > 0
    && leftText === rightText
    && intersectionOverUnion(left.bounds, right.bounds) >= 0.8;
}

function targetOverlapsBounds(target, bounds) {
  if (isBox(target?.bounds)) return overlapBySmallerArea(target.bounds, bounds) >= 0.5;
  if (Number.isFinite(target?.x) && Number.isFinite(target?.y)) {
    return target.x >= bounds.x && target.x < bounds.x + bounds.width
      && target.y >= bounds.y && target.y < bounds.y + bounds.height;
  }
  return false;
}

function complementConfidence(scores) {
  return Math.round((1 - scores.reduce((product, score) => product * (1 - score), 1)) * 1_000_000) / 1_000_000;
}

function finiteConfidence(value, fallback) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function frozenResult(elements, knownControls, diagnostics) {
  return Object.freeze({
    elements: Object.freeze(elements.map((element) => Object.freeze({ ...element }))),
    knownControls: Object.freeze(knownControls),
    diagnostics: Object.freeze({ ...diagnostics }),
  });
}

function isBox(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.x) && value.x >= 0
    && Number.isFinite(value.y) && value.y >= 0
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function area(value) {
  return value.width * value.height;
}

function compareArea(left, right) {
  return area(left.bounds) - area(right.bounds)
    || left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x;
}

function overlapBySmallerArea(left, right) {
  const intersection = intersectionArea(left, right);
  return intersection / Math.min(area(left), area(right));
}

function intersectionOverUnion(left, right) {
  const intersection = intersectionArea(left, right);
  const union = area(left) + area(right) - intersection;
  return union === 0 ? 0 : intersection / union;
}

function intersectionArea(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function stableBoxId(value) {
  return `${value.x}:${value.y}:${value.width}:${value.height}`;
}

function scanHorizontal(image, x, y, tolerance) {
  const color = pixelAt(image, x, y);
  let left = x;
  let right = x;
  while (left > 0 && similarColor(pixelAt(image, left - 1, y), color, tolerance)) left -= 1;
  while (right < image.width - 1 && similarColor(pixelAt(image, right + 1, y), color, tolerance)) right += 1;
  return { x: left, y, width: right - left + 1, color };
}

function scanVertical(image, x, y, tolerance) {
  const color = pixelAt(image, x, y);
  let top = y;
  let bottom = y;
  while (top > 0 && similarColor(pixelAt(image, x, top - 1), color, tolerance)) top -= 1;
  while (bottom < image.height - 1 && similarColor(pixelAt(image, x, bottom + 1), color, tolerance)) bottom += 1;
  return { x, y: top, height: bottom - top + 1 };
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return {
    r: image.data[offset] ?? 0,
    g: image.data[offset + 1] ?? 0,
    b: image.data[offset + 2] ?? 0,
  };
}

function similarColor(left, right, tolerance) {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b),
  ) <= tolerance;
}

function isPixelImage(value) {
  return value !== null && typeof value === "object"
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && value.data?.length >= value.width * value.height * 4;
}

async function readPixels(path) {
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
