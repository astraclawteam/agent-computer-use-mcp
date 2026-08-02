import { proposeSomFromImageFile } from "./som-proposal-provider.mjs";
import { normalizeRecognizedUiText } from "./ui-text-normalization.mjs";
import {
  detectControlSurfaceFromPixels,
  readImagePixels,
} from "./control-surface-detection.mjs";

const SEARCH_LABELS = new Set(["search", "find", "搜索", "查找"]);
const VISUAL_THRESHOLDS = Object.freeze([8, 24]);
const CONVERSATION_STRUCTURE_ROLES = Object.freeze([
  "conversation-pane",
  "conversation-header",
  "conversation-transcript",
  "message-editor",
]);

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
  const deduplicated = deduplicateVisualProposals(proposals);
  return deduplicateVisualProposals([
    ...deduplicated,
    ...inferSearchVisualStructure({ pixels, proposals: deduplicated }),
    ...inferConversationVisualStructure({ pixels }),
  ]);
}

export function inferSearchVisualStructure({ pixels, proposals = [] } = {}) {
  if (!pixels || !Number.isFinite(pixels.width) || !Number.isFinite(pixels.height)) return [];
  const candidates = proposals.flatMap((proposal) => {
    if (!isBox(proposal?.bounds) || proposal.source !== "som-proposal") return [];
    const surface = detectControlSurfaceFromPixels(pixels, proposal.bounds);
    if (!isSearchSurfaceGeometry(surface, proposal.bounds, pixels)) return [];
    return [{
      proposalId: `visual-search-surface:${stableBoxId(surface)}`,
      role: "search-surface",
      bounds: surface,
      confidence: complementConfidence([
        finiteConfidence(proposal.confidence, 0.7),
        0.92,
      ]),
      source: "visual-structure",
      supportProposalId: proposal.proposalId,
      pixelLimitedAction: true,
      guessedAction: false,
    }];
  });
  return deduplicateVisualProposals(candidates);
}

export function inferConversationVisualStructure({ pixels } = {}) {
  if (!pixels || !Number.isFinite(pixels.width) || !Number.isFinite(pixels.height)) return [];
  const paneLeft = strongestVerticalEdge(pixels, {
    start: Math.round(pixels.width * 0.22),
    end: Math.round(pixels.width * 0.45),
    yStart: Math.round(pixels.height * 0.04),
    yEnd: Math.round(pixels.height * 0.96),
  });
  if (!paneLeft || paneLeft.score < 10) return [];
  const headerTop = strongestHorizontalEdge(pixels, {
    start: Math.round(pixels.height * 0.02),
    end: Math.round(pixels.height * 0.08),
    xStart: paneLeft.position + 1,
    xEnd: pixels.width - 2,
  });
  const headerBottom = strongestHorizontalEdge(pixels, {
    start: Math.round(pixels.height * 0.08),
    end: Math.round(pixels.height * 0.18),
    xStart: paneLeft.position + 1,
    xEnd: pixels.width - 2,
  });
  const editorTop = strongestHorizontalEdge(pixels, {
    start: Math.round(pixels.height * 0.60),
    end: Math.round(pixels.height * 0.90),
    xStart: paneLeft.position + 1,
    xEnd: pixels.width - 2,
  });
  if (!headerTop || !headerBottom || !editorTop
    || headerTop.score < 10 || headerBottom.score < 8 || editorTop.score < 10
    || !(headerTop.position < headerBottom.position && headerBottom.position < editorTop.position)) {
    return [];
  }
  const left = paneLeft.position + 1;
  const right = pixels.width - 1;
  const bottom = pixels.height - 1;
  const boxes = [
    ["conversation-pane", { x: left, y: headerTop.position + 1, width: right - left, height: bottom - headerTop.position }],
    ["conversation-header", { x: left, y: headerTop.position + 1, width: right - left, height: headerBottom.position - headerTop.position }],
    ["conversation-transcript", { x: left, y: headerBottom.position + 1, width: right - left, height: editorTop.position - headerBottom.position - 1 }],
    ["message-editor", { x: left, y: editorTop.position + 1, width: right - left, height: bottom - editorTop.position }],
  ];
  const confidence = complementConfidence([
    edgeConfidence(paneLeft.score),
    edgeConfidence(headerBottom.score),
    edgeConfidence(editorTop.score),
  ]);
  return boxes.map(([role, bounds]) => ({
    proposalId: `visual-${role}:${stableBoxId(bounds)}`,
    role,
    bounds,
    confidence,
    source: "visual-structure",
    pixelLimitedAction: role === "message-editor",
    guessedAction: false,
  }));
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
    const text = ocr.filter((element) => ocrBelongsToEditable(owners[0].bounds, element));
    const evidence = editableEvidenceForKnownControl(text, owners[0].bounds);
    if (!evidence.support) continue;
    const verifiedValueConflict = typeof control.verifiedValue === "string"
      && normalizeControlLabel(evidence.value) !== normalizeControlLabel(control.verifiedValue);
    const boundsConflict = materiallyDifferentOwners(owners);
    const conflict = boundsConflict || evidence.conflict || verifiedValueConflict;
    const composition = searchComposition({
      ocr: evidence.support,
      owners,
      conflict,
      conflictReasons: [
        ...(boundsConflict ? ["bounds"] : []),
        ...((evidence.conflict || verifiedValueConflict) ? ["value"] : []),
      ],
      value: evidence.value,
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push({
      ...composition.knownControl,
      ...(typeof control.verifiedValue === "string"
        ? {
            verifiedValue: control.verifiedValue,
            verifiedAtObservationId: control.verifiedAtObservationId,
            ...(isBox(control.verifiedValueBounds)
              ? { verifiedValueBounds: { ...control.verifiedValueBounds } }
              : {}),
          }
        : {}),
    });
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
      conflictReasons: conflict ? ["bounds"] : [],
      value: semanticSearchValue(item),
      focusedTarget,
    });
    elements.push(...composition.elements);
    if (!conflict) nextKnownControls.push(composition.knownControl);
  }

  if (!elements.some((element) => element.role === "search")) {
    const structuralOwners = visual.filter((proposal) => (
      proposal.source === "visual-structure" && proposal.role === "search-surface"
    ));
    if (structuralOwners.length === 1) {
      const [owner] = structuralOwners;
      const support = visual.find((proposal) => (
        proposal.source === "som-proposal"
        && proposal.proposalId === owner.supportProposalId
        && contains(owner.bounds, proposal.bounds)
      ));
      if (support) {
        const composition = searchComposition({
          ocr: support,
          owners: [owner],
          conflict: false,
          value: "",
          focusedTarget,
        });
        elements.push(...composition.elements);
        nextKnownControls.push(composition.knownControl);
      }
    }
  }

  const conversation = composeConversationSceneElements({
    ocr,
    visual,
    focusedTarget,
  });
  elements.push(...conversation);

  return frozenResult(elements, uniqueKnownControls(nextKnownControls));
}

function composeConversationSceneElements({ ocr, visual, focusedTarget }) {
  const structures = new Map();
  for (const role of CONVERSATION_STRUCTURE_ROLES) {
    const matches = visual.filter((proposal) => (
      proposal.source === "visual-structure" && proposal.role === role
    ));
    if (matches.length !== 1) return [];
    structures.set(role, matches[0]);
  }
  const pane = structures.get("conversation-pane");
  const header = structures.get("conversation-header");
  const transcript = structures.get("conversation-transcript");
  const editor = structures.get("message-editor");
  const titleCandidates = ocr.filter((element) => (
    contains(header.bounds, element.bounds)
    && element.bounds.x < header.bounds.x + (header.bounds.width * 0.55)
    && elementText(element).trim().length > 0
  ));
  const title = titleCandidates.length === 1 ? titleCandidates[0] : null;
  const editorVisual = visual
    .filter((proposal) => proposal.source === "som-proposal" && contains(editor.bounds, proposal.bounds))
    .sort(compareArea)[0] ?? null;
  const paneToken = `conversation:${stableBoxId(pane.bounds)}`;
  const headerToken = `conversation-header:${stableBoxId(header.bounds)}`;
  const transcriptToken = `conversation-transcript:${stableBoxId(transcript.bounds)}`;
  const editorToken = `message-editor:${stableBoxId(editor.bounds)}`;
  const elements = [{
    hostType: "Container",
    elementToken: paneToken,
    role: "conversation",
    name: "Conversation",
    bounds: pane.bounds,
    sourceRegion: pane.bounds,
    source: "visual-structure",
    confidence: pane.confidence,
    actions: [],
    support: independentSupport(pane, null),
    guessedAction: false,
  }, {
    hostType: "Container",
    elementToken: headerToken,
    parentElementToken: paneToken,
    role: "conversation-header",
    name: "Conversation header",
    bounds: header.bounds,
    sourceRegion: header.bounds,
    source: "visual-structure",
    confidence: header.confidence,
    actions: [],
    support: independentSupport(header, null),
    guessedAction: false,
  }, {
    hostType: "Container",
    elementToken: transcriptToken,
    parentElementToken: paneToken,
    role: "transcript",
    name: "Transcript",
    bounds: transcript.bounds,
    sourceRegion: transcript.bounds,
    source: "visual-structure",
    confidence: transcript.confidence,
    actions: [],
    support: independentSupport(transcript, null),
    guessedAction: false,
  }];
  if (title) {
    const support = independentSupport(header, title);
    elements.push({
      hostType: "ActionableItem",
      elementToken: `conversation-title:${stableBoxId(title.bounds)}`,
      parentElementToken: headerToken,
      role: "conversation-title",
      name: elementText(title),
      value: elementText(title),
      bounds: title.bounds,
      sourceRegion: header.bounds,
      source: "local-proposal-fusion",
      modelIdentity: { provider: "local-proposal-fusion", model: "conversation-header-ocr-v1" },
      confidence: complementConfidence(support.map((entry) => entry.confidence)),
      actions: [],
      support,
      guessedAction: false,
      semanticKey: `conversation-title:${normalizeControlLabel(elementText(title))}`,
    });
  }
  if (editorVisual) {
    const support = independentSupport(editor, editorVisual);
    elements.push({
      hostType: "Editable",
      elementToken: editorToken,
      parentElementToken: paneToken,
      role: "message-editor",
      name: "Message editor",
      value: "",
      bounds: editor.bounds,
      sourceRegion: editor.bounds,
      source: "local-proposal-fusion",
      modelIdentity: { provider: "local-proposal-fusion", model: "conversation-editor-structure-v1" },
      confidence: complementConfidence(support.map((entry) => entry.confidence)),
      actions: ["click", "type_text"],
      support,
      pixelLimitedAction: true,
      guessedAction: false,
      semanticKey: "editor:primary",
      state: { focused: targetOverlapsBounds(focusedTarget, editor.bounds) },
    });
  }
  return elements;
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
  const searchDecorationLength = leadingSearchDecorationLength(characters.join(""));
  if (searchDecorationLength > 0) {
    return characters.slice(searchDecorationLength).join("").trimStart();
  }
  let removedLeadingDecoration = false;
  if (characters.length > 1
    && isOcrDecorationCharacter(characters[0])
    && (element.bounds.x < bounds.x + (bounds.width * 0.1)
      || /^\s$/u.test(characters[1]))) {
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
  const decorationLength = leadingSearchDecorationLength(characters.join(""));
  if (decorationLength > 0) {
    return {
      ...element.bounds,
      x: element.bounds.x + (element.bounds.width * (decorationLength / characters.length)),
      width: element.bounds.width * ((characters.length - decorationLength) / characters.length),
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

function searchComposition({ ocr, owners, conflict, conflictReasons = [], value, focusedTarget }) {
  const owner = [...owners].sort(compareArea)[0];
  const bounds = { ...owner.bounds };
  const support = independentSupport(owner, ocr);
  const confidence = complementConfidence(support.map((entry) => entry.confidence));
  const parentToken = `local-search-container:${stableBoxId(bounds)}`;
  const elementToken = `local-search:${stableBoxId(bounds)}`;
  const valueBounds = searchValueBoundsFromEvidence(ocr, bounds);
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
    ...(conflict ? { evidenceConsistency: "conflict", conflicts: [...new Set(conflictReasons)] } : {}),
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
      state: {
        focused: targetOverlapsBounds(focusedTarget, bounds),
        ...(valueBounds ? { valueBounds } : {}),
      },
    }],
    knownControl: {
      role: "search",
      bounds,
      semanticKey: "control:search",
    },
  };
}

function searchValueBoundsFromEvidence(element, ownerBounds) {
  if (!isOcrElement(element)) return null;
  const text = elementText(element);
  const characters = [...text];
  const decorationLength = leadingSearchDecorationLength(text);
  if (decorationLength === 0 || characters.length === 0) return null;
  const semanticBounds = semanticLabelBounds(element);
  const averageCharacterWidth = element.bounds.width / characters.length;
  const decorationAdjustment = averageCharacterWidth * 0.3 * Math.max(0, decorationLength - 1);
  const x = Math.max(ownerBounds.x, semanticBounds.x - decorationAdjustment);
  const rightInset = Math.max(12, Math.min(
    Math.round(ownerBounds.height * 1.1),
    Math.floor(ownerBounds.width * 0.25),
  ));
  const right = ownerBounds.x + ownerBounds.width - rightInset;
  if (right <= x) return null;
  return { x, y: ownerBounds.y, width: right - x, height: ownerBounds.height };
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

function ocrBelongsToEditable(editableBounds, element) {
  const ocrBounds = isSearchIconDecoratedText(elementText(element))
    ? semanticLabelBounds(element)
    : element.bounds;
  const horizontalOverlap = intersectionLength(
    editableBounds.x,
    editableBounds.x + editableBounds.width,
    ocrBounds.x,
    ocrBounds.x + ocrBounds.width,
  ) / ocrBounds.width;
  const verticalOverlap = intersectionLength(
    editableBounds.y,
    editableBounds.y + editableBounds.height,
    ocrBounds.y,
    ocrBounds.y + ocrBounds.height,
  ) / ocrBounds.height;
  return horizontalOverlap >= 0.8 && verticalOverlap >= 0.75;
}

function visualOwnersForKnownControl(control, visual) {
  const controlArea = area(control.bounds);
  const candidates = visual
    .filter((proposal) => {
      const areaRatio = area(proposal.bounds) / controlArea;
      return overlapBySmallerArea(control.bounds, proposal.bounds) >= 0.75
        && areaRatio >= 0.5
        && areaRatio <= 1.5;
    });
  if (candidates.length === 0) return [];
  const compareControlMatch = (left, right) => (
    intersectionOverUnion(control.bounds, right.bounds)
      - intersectionOverUnion(control.bounds, left.bounds)
    || compareArea(left, right)
  );
  const semantic = candidates.filter(isSemanticSurface).sort(compareControlMatch);
  return [semantic[0] ?? [...candidates].sort(compareControlMatch)[0]];
}

function materiallyDifferentOwners(owners) {
  if (owners.length < 2) return false;
  const sorted = [...owners].sort(compareArea);
  return sorted.slice(1).some((owner) => intersectionOverUnion(sorted[0].bounds, owner.bounds) < 0.8);
}

function independentSupport(owner, ocr) {
  const support = [{
    provider: owner.source === "visual-structure" ? "visual-structure" : "som-proposal",
    confidence: finiteConfidence(owner.confidence, 0.7),
    proposalId: String(owner.proposalId ?? `visual:${stableBoxId(owner.bounds)}`),
  }];
  if (ocr) support.push({
    provider: ocr.source === "ocr" ? "ocr" : String(ocr.source ?? "som-proposal"),
    confidence: finiteConfidence(ocr.confidence, 0.9),
    proposalId: String(ocr.proposalId ?? ocr.elementToken ?? "ocr-owned-label"),
  });
  return support;
}

function isSearchSurfaceGeometry(surface, evidenceBounds, pixels) {
  if (!isBox(surface) || !contains(surface, evidenceBounds)) return false;
  const aspectRatio = surface.width / surface.height;
  const widthRatio = surface.width / pixels.width;
  const heightRatio = surface.height / pixels.height;
  const centerY = evidenceBounds.y + (evidenceBounds.height / 2);
  return surface.x >= 0
    && surface.y >= 0
    && surface.x <= pixels.width * 0.35
    && surface.y <= pixels.height * 0.15
    && aspectRatio >= 4
    && widthRatio >= 0.07
    && widthRatio <= 0.35
    && heightRatio >= 0.02
    && heightRatio <= 0.09
    && centerY >= surface.y + 2
    && centerY <= surface.y + surface.height - 2
    && surface.width >= evidenceBounds.width * 3
    && surface.height >= evidenceBounds.height + 6;
}

function strongestVerticalEdge(pixels, { start, end, yStart, yEnd }) {
  let best = null;
  for (let x = Math.max(1, start); x <= Math.min(pixels.width - 2, end); x += 1) {
    let total = 0;
    let samples = 0;
    for (let y = Math.max(1, yStart); y <= Math.min(pixels.height - 2, yEnd); y += 4) {
      total += adjacentPixelDifference(pixels, x, y, x - 1, y);
      samples += 1;
    }
    const score = samples > 0 ? total / samples : 0;
    if (!best || score > best.score) best = { position: x, score };
  }
  return best;
}

function strongestHorizontalEdge(pixels, { start, end, xStart, xEnd }) {
  let best = null;
  for (let y = Math.max(1, start); y <= Math.min(pixels.height - 2, end); y += 1) {
    let total = 0;
    let samples = 0;
    let coveredSamples = 0;
    for (let x = Math.max(1, xStart); x <= Math.min(pixels.width - 2, xEnd); x += 4) {
      const difference = adjacentPixelDifference(pixels, x, y, x, y - 1);
      total += difference;
      if (difference >= 8) coveredSamples += 1;
      samples += 1;
    }
    const score = samples > 0 ? total / samples : 0;
    const coverage = samples > 0 ? coveredSamples / samples : 0;
    const candidate = { position: y, score, coverage };
    if (!best || compareHorizontalEdge(candidate, best) < 0) best = candidate;
  }
  return best;
}

function compareHorizontalEdge(left, right) {
  const leftSpansPane = left.coverage >= 0.55;
  const rightSpansPane = right.coverage >= 0.55;
  if (leftSpansPane !== rightSpansPane) return leftSpansPane ? -1 : 1;
  return right.score - left.score || right.coverage - left.coverage || left.position - right.position;
}

function adjacentPixelDifference(pixels, x1, y1, x2, y2) {
  const first = ((y1 * pixels.width) + x1) * 4;
  const second = ((y2 * pixels.width) + x2) * 4;
  return Math.abs(pixels.data[first] - pixels.data[second])
    + Math.abs(pixels.data[first + 1] - pixels.data[second + 1])
    + Math.abs(pixels.data[first + 2] - pixels.data[second + 2]);
}

function edgeConfidence(score) {
  return Math.min(0.99, 0.7 + (Math.max(0, score - 8) / 160));
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
  const decorationLength = leadingSearchDecorationLength(text);
  if (decorationLength === 0) return "";
  const value = [...text].slice(decorationLength).join("").trimStart();
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
  return leadingSearchDecorationLength(value) > 0;
}

function leadingSearchDecorationLength(value) {
  const normalized = normalizeRecognizedUiText(String(value ?? ""), {
    languageClass: "mixed",
  });
  if (!/^Q(?=[^a-z])/u.test(normalized)) return 0;
  const characters = [...normalized];
  let length = 1;
  while (length < characters.length && /^[\s.\-_:·•?]$/u.test(characters[length])) {
    length += 1;
  }
  return length;
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

function intersectionLength(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function stableBoxId(value) {
  return `${value.x}:${value.y}:${value.width}:${value.height}`;
}
