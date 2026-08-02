import {
  conversationEntitySemanticKey,
  normalizeRecognizedUiText,
} from "./ui-text-normalization.mjs";

const MAX_RESULT_LINE_HEIGHT = 96;

export function composeOwnedTransientSceneElements({
  mainCapture,
  searchControl,
  surfaces = [],
} = {}) {
  if (!isBox(mainCapture) || !isBox(searchControl?.bounds)) return [];
  const mainWindowId = String(mainCapture.windowId ?? mainCapture.hwnd ?? "");
  if (mainWindowId === "") return [];

  const elements = [];
  for (const surface of surfaces) {
    if (!isProvenRelatedSurface(surface, mainWindowId)
      || !isSearchOwnedSurface({ mainCapture, searchControl, surface })) continue;
    const coordinate = surfaceCoordinate(surface, mainWindowId);
    if (!coordinate) continue;
    const relationship = surface.surfaceProvenance.relationship;
    const windowToken = `owned-window:${surface.hwnd}`;
    const surfaceToken = `search-results:${surface.hwnd}`;
    const bounds = { x: 0, y: 0, width: surface.width, height: surface.height };
    elements.push({
      hostType: "Window",
      role: relationship === "owned-window"
        ? "owned-auxiliary-window"
        : "same-process-auxiliary-window",
      elementToken: windowToken,
      parentSceneRoot: true,
      bounds,
      sourceRegion: bounds,
      source: "semantic",
      actions: [],
      name: surface.title || null,
      coordinate,
      support: nativeSurfaceSupport(surface),
    }, {
      hostType: "TransientSurface",
      role: "search-results",
      elementToken: surfaceToken,
      parentElementToken: windowToken,
      bounds,
      sourceRegion: bounds,
      source: "semantic",
      actions: [],
      coordinate,
      semanticKey: `search-results:${surface.hwnd}`,
      support: nativeSurfaceSupport(surface),
    });
    elements.push(...searchResultElements({
      surface,
      parentElementToken: surfaceToken,
      coordinate,
    }));
  }
  return elements;
}

function searchResultElements({ surface, parentElementToken, coordinate }) {
  const ocrElements = (Array.isArray(surface.ocrElements) ? surface.ocrElements : [])
    .filter((element) => element?.source === "ocr" && isBox(element.bounds))
    .filter((element) => finiteConfidence(element.confidence, 0) >= 0.6)
    .filter((element) => elementText(element) !== "");
  const proposals = (Array.isArray(surface.visualProposals) ? surface.visualProposals : [])
    .filter((proposal) => isBox(proposal?.bounds))
    .filter((proposal) => contains(
      { x: 0, y: 0, width: surface.width, height: surface.height },
      proposal.bounds,
    ));
  const lines = groupOcrLines(ocrElements);
  const rows = new Map();
  for (const line of lines) {
    if (line.bounds.height > MAX_RESULT_LINE_HEIGHT) continue;
    if (isTrailingAccessoryLine(line, surface)) continue;
    const owners = visualOwnersForLine(line.bounds, proposals, surface);
    if (owners.length === 0) continue;
    const owner = owners[0];
    const ownerId = String(owner.proposalId ?? `visual:${stableBoxId(owner.bounds)}`);
    const conflictingOwners = owners.slice(1).some(
      (candidate) => intersectionOverUnion(owner.bounds, candidate.bounds) < 0.7,
    );
    const existing = rows.get(ownerId);
    if (existing) {
      existing.lines.push(line);
      existing.owner.bounds = unionBounds([existing.owner.bounds, owner.bounds]);
      existing.conflicting ||= conflictingOwners;
    } else {
      rows.set(ownerId, {
        owner: { ...owner, bounds: { ...owner.bounds } },
        ownerId,
        lines: [line],
        conflicting: conflictingOwners,
      });
    }
  }
  const elements = [];
  for (const row of rows.values()) {
    const name = row.lines.map((line) => line.elements.map(elementText).join(" ").trim())
      .filter(Boolean)
      .join(" ");
    const normalizedName = normalizeLabel(name);
    if (normalizedName === "") continue;
    const visualConfidence = finiteConfidence(row.owner.confidence, 0.9);
    const ocrConfidence = Math.min(...row.lines.flatMap((line) => line.elements).map(
      (element) => finiteConfidence(element.confidence, 0.9),
    ));
    const confidence = complementConfidence([visualConfidence, ocrConfidence]);
    elements.push({
      hostType: "ActionableItem",
      role: "search-result",
      elementToken: `search-result:${surface.hwnd}:${stableBoxId(row.owner.bounds)}:${normalizedName}`,
      parentElementToken,
      bounds: { ...row.owner.bounds },
      sourceRegion: { ...row.owner.bounds },
      source: "local-proposal-fusion",
      modelIdentity: { provider: "local-proposal-fusion", model: "owned-surface-som-ocr-v1" },
      actions: row.conflicting ? [] : ["click"],
      name,
      semanticKey: conversationEntitySemanticKey(normalizedName),
      confidence,
      proposalId: row.ownerId,
      pixelLimitedAction: true,
      guessedAction: false,
      coordinate,
      support: [{
        provider: "som-proposal",
        confidence: visualConfidence,
        proposalId: row.ownerId,
      }, {
        provider: "ocr",
        confidence: ocrConfidence,
        proposalId: `ocr-row:${row.lines.map((line) => stableBoxId(line.bounds)).join("|")}`,
      }],
      ...(row.conflicting ? {
        evidenceConsistency: "conflict",
        conflicts: ["bounds"],
      } : {}),
    });
  }
  return elements;
}

function isTrailingAccessoryLine(line, surface) {
  const text = line.elements.map(elementText).join("").trim();
  return line.bounds.x >= surface.width * 0.75
    && line.bounds.width <= Math.max(40, line.bounds.height * 2.5)
    && [...text].length <= 2;
}

function groupOcrLines(elements) {
  const lines = [];
  for (const element of [...elements].sort(compareReadingOrder)) {
    const centerY = element.bounds.y + (element.bounds.height / 2);
    const line = lines.find((candidate) => (
      Math.abs(candidate.centerY - centerY)
        <= Math.max(candidate.height, element.bounds.height) * 0.55
    ));
    if (line) {
      line.elements.push(element);
      line.elements.sort((left, right) => left.bounds.x - right.bounds.x);
      line.bounds = unionBounds(line.elements.map((item) => item.bounds));
      line.centerY = line.bounds.y + (line.bounds.height / 2);
      line.height = line.bounds.height;
    } else {
      lines.push({
        elements: [element],
        bounds: { ...element.bounds },
        centerY,
        height: element.bounds.height,
      });
    }
  }
  return lines.flatMap(splitLineSegments);
}

function splitLineSegments(line) {
  const segments = [];
  for (const element of line.elements) {
    const previous = segments.at(-1);
    const previousRight = previous
      ? previous.elements.at(-1).bounds.x + previous.elements.at(-1).bounds.width
      : null;
    const gap = previousRight === null ? 0 : element.bounds.x - previousRight;
    const splitGap = Math.max(40, Math.max(previous?.height ?? 0, element.bounds.height) * 2.5);
    if (!previous || gap > splitGap) {
      segments.push({
        elements: [element],
        bounds: { ...element.bounds },
        centerY: element.bounds.y + (element.bounds.height / 2),
        height: element.bounds.height,
      });
      continue;
    }
    previous.elements.push(element);
    previous.bounds = unionBounds(previous.elements.map((item) => item.bounds));
    previous.centerY = previous.bounds.y + (previous.bounds.height / 2);
    previous.height = previous.bounds.height;
  }
  return segments;
}

function visualOwnersForLine(lineBounds, proposals, surface) {
  const surfaceArea = surface.width * surface.height;
  const overlapping = proposals
    .filter((proposal) => overlapBySmallerArea(proposal.bounds, lineBounds) >= 0.6)
    .filter((proposal) => proposal.bounds.height <= MAX_RESULT_LINE_HEIGHT)
    .filter((proposal) => area(proposal.bounds) <= surfaceArea * 0.5)
    .filter((proposal) => proposal.bounds.width >= lineBounds.width * 0.8);
  const adjacent = proposals
    .filter((proposal) => area(proposal.bounds) <= surfaceArea * 0.1)
    .filter((proposal) => proposal.bounds.height <= MAX_RESULT_LINE_HEIGHT)
    .filter((proposal) => verticalOverlapBySmallerHeight(proposal.bounds, lineBounds) >= 0.6)
    .filter((proposal) => {
      const gap = lineBounds.x - (proposal.bounds.x + proposal.bounds.width);
      return gap >= -8 && gap <= Math.max(24, lineBounds.height * 2);
    })
    .map((proposal) => ({
      ...proposal,
      proposalId: `row-anchor:${proposal.proposalId ?? stableBoxId(proposal.bounds)}`,
      bounds: unionBounds([proposal.bounds, lineBounds]),
      confidence: finiteConfidence(proposal.confidence, 0.7) * 0.95,
    }))
    .filter((proposal) => area(proposal.bounds) <= surfaceArea * 0.25);
  const candidates = [...overlapping, ...adjacent].sort(compareArea);
  if (candidates.length === 0) return [];
  const smallest = area(candidates[0].bounds);
  return candidates.filter((candidate) => area(candidate.bounds) <= smallest * 1.25);
}

function isProvenRelatedSurface(surface, mainWindowId) {
  const provenance = surface?.surfaceProvenance;
  const relatedWindowId = String(surface?.hwnd ?? "");
  const relationship = provenance?.relationship;
  const ownedByMain = relationship === "owned-window"
    && String(provenance?.ownerWindowId ?? "") === mainWindowId;
  const sameProcessAuxiliary = relationship === "same-process-auxiliary"
    && Number.isSafeInteger(provenance?.requestedProcessId)
    && provenance.requestedProcessId > 0
    && provenance.requestedProcessId === provenance.relatedProcessId;
  return surface?.status === "ok"
    && provenance?.relationshipVerified === true
    && typeof surface.screenshotId === "string"
    && surface.screenshotId.length > 0
    && String(provenance?.requestedWindowId ?? "") === mainWindowId
    && String(provenance?.relatedWindowId ?? "") === relatedWindowId
    && (ownedByMain || sameProcessAuxiliary)
    && relatedWindowId !== ""
    && relatedWindowId !== mainWindowId
    && isBox({ x: surface.x, y: surface.y, width: surface.width, height: surface.height });
}

function isSearchOwnedSurface({ mainCapture, searchControl, surface }) {
  const searchScreen = {
    x: mainCapture.x + searchControl.bounds.x,
    y: mainCapture.y + searchControl.bounds.y,
    width: searchControl.bounds.width,
    height: searchControl.bounds.height,
  };
  const surfaceBounds = {
    x: surface.x,
    y: surface.y,
    width: surface.width,
    height: surface.height,
  };
  const horizontalOverlap = intersectionLength(
    searchScreen.x,
    searchScreen.x + searchScreen.width,
    surfaceBounds.x,
    surfaceBounds.x + surfaceBounds.width,
  );
  const verticalGap = surfaceBounds.y - (searchScreen.y + searchScreen.height);
  return horizontalOverlap >= Math.min(searchScreen.width, surfaceBounds.width) * 0.5
    && verticalGap >= -12
    && verticalGap <= 64
    && surfaceBounds.height >= 40;
}

function surfaceCoordinate(surface, mainWindowId) {
  const transform = surface.coordinateScale?.actionTransform;
  if (!transform || ![transform.scaleX, transform.scaleY, transform.offsetX, transform.offsetY]
    .every(Number.isFinite)) return null;
  return {
    screenshotId: String(surface.screenshotId),
    windowId: String(surface.hwnd),
    space: "window-local",
    cropOffset: { x: 0, y: 0 },
    scale: {
      x: positiveNumber(surface.coordinateScale?.nativeToObservation?.scaleX, 1),
      y: positiveNumber(surface.coordinateScale?.nativeToObservation?.scaleY, 1),
    },
    actionWindowId: mainWindowId,
    actionTransform: {
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    },
  };
}

function nativeSurfaceSupport(surface) {
  return [{
    provider: "windows-window-relationship",
    confidence: 1,
    proposalId: `window:${surface.hwnd}`,
  }, {
    provider: "cua-driver-related-screenshot",
    confidence: 1,
    proposalId: String(surface.screenshotId),
  }];
}

function elementText(element) {
  const value = typeof element?.name === "string"
    ? element.name
    : typeof element?.value === "string"
      ? element.value
      : "";
  return normalizeRecognizedUiText(value, { languageClass: "mixed" }).trim();
}

function normalizeLabel(value) {
  return normalizeRecognizedUiText(value, { languageClass: "mixed" })
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();
}

function compareReadingOrder(left, right) {
  return left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x;
}

function compareArea(left, right) {
  return area(left.bounds) - area(right.bounds)
    || left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x;
}

function unionBounds(bounds) {
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
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
  return intersectionLength(left.x, left.x + left.width, right.x, right.x + right.width)
    * intersectionLength(left.y, left.y + left.height, right.y, right.y + right.height);
}

function intersectionLength(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function verticalOverlapBySmallerHeight(left, right) {
  return intersectionLength(left.y, left.y + left.height, right.y, right.y + right.height)
    / Math.min(left.height, right.height);
}

function complementConfidence(scores) {
  return Math.round((1 - scores.reduce((product, score) => product * (1 - score), 1)) * 1_000_000) / 1_000_000;
}

function finiteConfidence(value, fallback) {
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function stableBoxId(value) {
  return `${value.x}:${value.y}:${value.width}:${value.height}`;
}

function area(bounds) {
  return bounds.width * bounds.height;
}

function isBox(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}
