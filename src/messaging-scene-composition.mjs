import { proposeSomFromImageFile } from "./som-proposal-provider.mjs";
import { normalizeRecognizedUiText } from "./ui-text-normalization.mjs";
import {
  detectControlSurfaceFromPixels,
  readImagePixels,
} from "./control-surface-detection.mjs";

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
    const superseded = current.some((candidate) => sameOcrRegion(candidate, previous));
    const duplicate = merged.some((candidate) => sameOcrOccurrence(candidate, previous));
    if (!superseded && !duplicate) merged.push(previous);
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
  const pixels = await readImagePixels(imagePath);
  const semanticSurfaces = ocrElements.flatMap((element, index) => {
    if (!isOcrElement(element) || semanticControlRole(elementText(element)) === null) return [];
    const surface = detectControlSurfaceFromPixels(pixels, semanticLabelBounds(element));
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
  return deduplicateVisualProposals(proposals);
}

export function composeMessagingSceneElements({
  coordinateBounds,
  ocrElements = [],
  visualProposals = [],
  knownControls = [],
  focusedTarget = null,
} = {}) {
  if (!isBox(coordinateBounds)) return frozenResult([], []);
  const ocr = ocrElements.filter(isOcrElement);
  const visual = visualProposals.filter((proposal) => isBox(proposal?.bounds));
  const elements = [];
  const nextKnownControls = [];
  const consumedOcr = new Set();

  for (const control of normalizeKnownControls(knownControls, coordinateBounds)) {
    const owners = visualOwnersForKnownControl(control, visual);
    if (owners.length === 0) continue;
    const text = ocr.filter((element) => ocrBelongsToEditable(owners[0].bounds, element.bounds));
    const evidence = editableEvidenceForKnownControl(text, owners[0].bounds);
    if (!evidence.support) continue;
    const conflict = materiallyDifferentOwners(owners) || evidence.conflict;
    const composition = searchComposition({
      ocr: evidence.support,
      owners,
      conflict,
      value: evidence.value,
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push(composition.knownControl);
    for (const item of text) consumedOcr.add(item);
  }

  for (const item of ocr) {
    if (consumedOcr.has(item) || semanticControlRole(elementText(item)) !== "search") continue;
    const owners = visualOwnersForOcr({ ...item, bounds: semanticLabelBounds(item) }, visual);
    if (owners.length === 0) continue;
    const conflict = materiallyDifferentOwners(owners);
    const composition = searchComposition({
      ocr: item,
      owners,
      conflict,
      value: semanticSearchValue(item),
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push(composition.knownControl);
  }

  return frozenResult(elements, uniqueKnownControls(nextKnownControls));
}

function editableEvidenceForKnownControl(elements, bounds) {
  const contentLeft = bounds.x + (bounds.width * 0.1);
  const contentRight = bounds.x + (bounds.width * 0.9);
  const content = elements
    .filter((element) => {
      const centerX = element.bounds.x + (element.bounds.width / 2);
      return centerX >= contentLeft && centerX <= contentRight;
    })
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
  const textByElement = new Map(content.map((element) => [
    element,
    editableElementText(element, bounds),
  ]));
  const placeholder = content.find(
    (element) => semanticControlRole(textByElement.get(element)) === "search",
  );
  const valueElements = content.filter(
    (element) => semanticControlRole(textByElement.get(element)) !== "search",
  );
  const conflictingValues = valueElements.some((left, index) => valueElements
    .slice(index + 1)
    .some((right) => intersectionOverUnion(left.bounds, right.bounds) >= 0.6
      && normalizeControlLabel(textByElement.get(left))
        !== normalizeControlLabel(textByElement.get(right))));
  return {
    support: valueElements[0] ?? placeholder ?? null,
    value: valueElements.map((element) => textByElement.get(element)).filter(Boolean).join(""),
    conflict: conflictingValues,
  };
}

function editableElementText(element, bounds) {
  const characters = [...elementText(element)];
  let removedLeadingDecoration = false;
  if (characters.length > 1
    && element.bounds.x < bounds.x + (bounds.width * 0.1)
    && isOcrDecorationCharacter(characters[0])) {
    characters.shift();
    removedLeadingDecoration = true;
  }
  if (characters.length > 1
    && element.bounds.x + element.bounds.width > bounds.x + (bounds.width * 0.9)
    && isOcrDecorationCharacter(characters.at(-1))) characters.pop();
  return removedLeadingDecoration ? characters.join("").trimStart() : characters.join("");
}

function semanticLabelBounds(element) {
  const characters = [...elementText(element)];
  if (isSearchIconDecoratedText(characters.join(""))) {
    return {
      ...element.bounds,
      x: element.bounds.x + (element.bounds.width / characters.length),
      width: element.bounds.width * ((characters.length - 1) / characters.length),
    };
  }
  const normalized = normalizeControlLabel(characters.join(""));
  const label = [...SEARCH_LABELS].find((candidate) => normalized.endsWith(candidate));
  if (!label || normalized === label || characters.length <= [...label].length) return element.bounds;
  const labelLength = [...label].length;
  const prefixLength = characters.length - labelLength;
  return {
    ...element.bounds,
    x: element.bounds.x + (element.bounds.width * (prefixLength / characters.length)),
    width: element.bounds.width * (labelLength / characters.length),
  };
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
      value: conflict ? null : value,
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

function ocrBelongsToEditable(editableBounds, ocrBounds) {
  return intersectionArea(editableBounds, ocrBounds) / area(ocrBounds) >= 0.8;
}

function visualOwnersForKnownControl(control, visual) {
  const controlArea = area(control.bounds);
  const candidates = visual
    .filter((proposal) => {
      const areaRatio = area(proposal.bounds) / controlArea;
      return overlapBySmallerArea(control.bounds, proposal.bounds) >= 0.75
        && areaRatio >= 0.5
        && areaRatio <= 1.5;
    })
    .sort(compareArea);
  if (candidates.length === 0) return [];
  const smallestArea = area(candidates[0].bounds);
  const semanticPeer = candidates.find((candidate) => (
    isSemanticSurface(candidate) && area(candidate.bounds) <= smallestArea * 1.15
  ));
  return [semanticPeer ?? candidates[0]];
}

function materiallyDifferentOwners(owners) {
  if (owners.length < 2) return false;
  const sorted = [...owners].sort(compareArea);
  return sorted.slice(1).some((owner) => intersectionOverUnion(sorted[0].bounds, owner.bounds) < 0.8);
}

function independentSupport(owner, ocr) {
  const support = [{
    provider: "som-proposal",
    confidence: finiteConfidence(owner.confidence, 0.7),
    proposalId: String(owner.proposalId ?? `visual:${stableBoxId(owner.bounds)}`),
  }];
  if (ocr) support.push({
    provider: "ocr",
    confidence: finiteConfidence(ocr.confidence, 0.9),
    proposalId: String(ocr.proposalId ?? ocr.elementToken ?? "ocr-owned-label"),
  });
  return support;
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
  if (isSearchIconDecoratedText(value)) return "search";
  const normalized = normalizeControlLabel(value);
  if (SEARCH_LABELS.has(normalized)) return "search";
  const label = [...SEARCH_LABELS].find((candidate) => normalized.endsWith(candidate));
  if (!label) return null;
  const prefix = normalized.slice(0, -label.length).trim();
  return prefix.length === 1 && isOcrDecorationCharacter(prefix) ? "search" : null;
}

function semanticSearchValue(element) {
  const text = elementText(element);
  if (!isSearchIconDecoratedText(text)) return "";
  const value = [...text].slice(1).join("").trimStart();
  return SEARCH_LABELS.has(normalizeControlLabel(value)) ? "" : value;
}

function normalizeControlLabel(value) {
  return normalizeRecognizedUiText(String(value ?? ""), { languageClass: "mixed" })
    .toLocaleLowerCase();
}

function isOcrDecorationCharacter(value) {
  return /^[a-z0-9.·•]$/iu.test(value);
}

function isSearchIconDecoratedText(value) {
  return /^Q(?=[^a-z])/u.test(normalizeRecognizedUiText(String(value ?? ""), {
    languageClass: "mixed",
  }));
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

function sameOcrRegion(left, right) {
  return overlapBySmallerArea(left.bounds, right.bounds) >= 0.8;
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

function frozenResult(elements, knownControls) {
  return Object.freeze({
    elements: Object.freeze(elements.map((element) => Object.freeze({ ...element }))),
    knownControls: Object.freeze(knownControls),
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
