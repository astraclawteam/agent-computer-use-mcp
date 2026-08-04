import {
  conversationEntitySemanticKey,
  normalizeRecognizedUiText,
} from "./ui-text-normalization.mjs";
import { readImagePixels } from "./control-surface-detection.mjs";

const MAX_RESULT_LINE_HEIGHT = 96;

const NEW_SURFACE_MIN_CHANGED_PIXEL_RATIO = 0.45;

export async function detectSameWindowNavigationSurface({
  imagePath,
  previousImagePath,
  ...options
} = {}) {
  if (typeof imagePath !== "string" || imagePath === "") return null;
  const pixels = await readImagePixels(imagePath);
  const previousPixels = typeof previousImagePath === "string"
    && previousImagePath !== ""
    && previousImagePath !== imagePath
    ? await readImagePixels(previousImagePath)
    : null;
  return detectSameWindowNavigationSurfaceFromPixels({
    ...options,
    pixels,
    previousPixels,
  });
}

export function detectSameWindowNavigationSurfaceFromPixels({
  pixels,
  previousPixels = null,
  navigationControl,
  ocrElements = [],
  changedRegion = null,
  knownSurfaceBounds = null,
} = {}) {
  if (!isPixelImage(pixels) || !isBox(navigationControl?.bounds)) return null;
  const viewport = { x: 0, y: 0, width: pixels.width, height: pixels.height };
  if (!contains(viewport, navigationControl.bounds)) return null;
  // When the target is an item the surface itself offered, the anchor is one of
  // that surface's rows. Dropping rows that overlap the anchor would then drop
  // exactly the row being acted on, and the item would not resolve.
  const anchorIsRowOfKnownSurface = isBox(knownSurfaceBounds)
    && isBox(navigationControl?.bounds)
    && overlapBySmallerArea(navigationControl.bounds, knownSurfaceBounds) >= 0.6;
  const nearbyOcr = (Array.isArray(ocrElements) ? ocrElements : [])
    .filter((element) => element?.source === "ocr" && isBox(element.bounds))
    .filter((element) => finiteConfidence(element.confidence, 0) >= 0.6)
    .filter((element) => contains(viewport, element.bounds))
    .filter((element) => anchorIsRowOfKnownSurface
      || intersectionArea(element.bounds, navigationControl.bounds)
        < area(element.bounds) * 0.5)
    .filter((element) => boxGap(element.bounds, navigationControl.bounds) <= 280)
    .sort((left, right) => boxGap(left.bounds, navigationControl.bounds)
      - boxGap(right.bounds, navigationControl.bounds));
  const seeds = nearbyOcr.slice(0, 12).flatMap((element) => {
    const y = Math.round(element.bounds.y + (element.bounds.height / 2));
    return [
      { x: Math.round(element.bounds.x + element.bounds.width + 12), y },
      { x: Math.round(element.bounds.x - 8), y },
    ];
  }).filter((point) => point.x >= 0 && point.x < pixels.width && point.y >= 0 && point.y < pixels.height);

  const detected = [];
  const seen = new Set();
  for (const seed of seeds) {
    const component = uniformPixelComponent(pixels, seed, 6);
    if (!component) continue;
    const key = stableBoxId(component.bounds);
    if (seen.has(key)) continue;
    seen.add(key);
    const componentArea = area(component.bounds);
    // Identity against a surface already proven open, established by overlap
    // rather than by where the anchor happens to be.
    const alreadyOpen = isBox(knownSurfaceBounds)
      && overlapBySmallerArea(component.bounds, knownSurfaceBounds) >= 0.6;
    const appearanceChangeRatio = comparablePixelImages(pixels, previousPixels)
      ? changedPixelRatio(previousPixels, pixels, component.bounds)
      : null;
    const compactAnchoredSurface = isCompactAnchoredSurface(
      component.bounds,
      navigationControl.bounds,
    );
    const stableAnchorOwnership = hasStableAnchorOwnership(
      component.bounds,
      navigationControl.bounds,
    );
    if (component.fillRatio < 0.7
      || component.bounds.width < 80
      || component.bounds.height < 40
      || componentArea > area(viewport) * 0.75) continue;
    // These gates assume the anchor is the control that opens the surface, and
    // so sits beside it rather than within it. Once the Agent acts on an item
    // the surface itself offered, the anchor is inside it and containment is
    // expected, so applying them there rejects the very surface being used.
    if (!alreadyOpen
      && (boxGap(component.bounds, navigationControl.bounds) > 160
        || !alignedWithAnchor(component.bounds, navigationControl.bounds)
        || intersectionArea(component.bounds, navigationControl.bounds)
          > area(navigationControl.bounds) * 0.2)) continue;
    const ownedOcr = nearbyOcr.filter((element) => contains(component.bounds, element.bounds));
    const rows = primaryOcrRows(ownedOcr, component.bounds);
    if (rows.length < 2) continue;
    const changeOverlap = isBox(changedRegion)
      ? overlapBySmallerArea(component.bounds, changedRegion)
      : 0;
    // Overlapping the changed region is how a surface proves it just appeared.
    // A surface that already proved it is open does not have to prove it again:
    // it stops changing the moment it finishes opening, so requiring the proof
    // on every frame makes an open menu vanish from the Scene while it is still
    // on screen, and every candidate it contributed goes stale.
    if (!alreadyOpen
      && isBox(changedRegion)
      && changeOverlap < 0.35
      && boxGap(component.bounds, changedRegion) > 24) continue;
    // A global dirty bounding box is only a scheduling hint: unrelated live
    // content can stretch it over a persistent sidebar and make that pane look
    // like a newly opened menu. When two frames are available, the candidate
    // surface itself has to prove that it appeared. Once a surface has already
    // been proven open, identity against its remembered bounds is sufficient
    // for carrying it across static frames.
    const transitionVerified = appearanceChangeRatio !== null
      && appearanceChangeRatio >= NEW_SURFACE_MIN_CHANGED_PIXEL_RATIO;
    if (!alreadyOpen
      && !transitionVerified
      && (!compactAnchoredSurface || !stableAnchorOwnership)) continue;
    detected.push({
      component,
      rows,
      changeOverlap,
      appearanceChangeRatio,
      compactAnchoredSurface,
      stableAnchorOwnership,
    });
  }
  detected.sort((left, right) => (
    right.rows.length - left.rows.length
    || right.changeOverlap - left.changeOverlap
    || area(left.component.bounds) - area(right.component.bounds)
  ));
  const best = detected[0];
  if (!best) return null;
  const rowProposals = best.rows.map((row, index) => ({
    proposalId: `navigation-row:${stableBoxId(best.component.bounds)}:${index}`,
    role: "navigation-row",
    source: "visual-structure",
    confidence: Math.min(0.99, 0.75 + (best.component.fillRatio * 0.2)),
    bounds: row.bounds,
  }));
  return {
    bounds: { ...best.component.bounds },
    ocrElements: best.rows.map((row) => row.label),
    visualProposals: rowProposals,
    support: {
      method: "anchor-local-uniform-surface",
      fillRatio: best.component.fillRatio,
      rowCount: best.rows.length,
      transitionVerified: best.appearanceChangeRatio !== null
        && best.appearanceChangeRatio >= NEW_SURFACE_MIN_CHANGED_PIXEL_RATIO,
      appearanceChangeRatio: best.appearanceChangeRatio,
      compactAnchoredSurface: best.compactAnchoredSurface,
      stableAnchorOwnership: best.stableAnchorOwnership,
    },
  };
}

function isCompactAnchoredSurface(surfaceBounds, anchorBounds) {
  if (!isBox(surfaceBounds) || !isBox(anchorBounds)) return false;
  // A menu that was already open before the Host arrived cannot prove an
  // appearance transition. It may still be recognised from independent flat
  // surface structure plus multiple OCR rows, but only while it remains a
  // compact control-owned surface. A persistent navigation/sidebar pane is
  // intentionally too tall to qualify.
  return surfaceBounds.height <= Math.max(320, anchorBounds.height * 12);
}

function hasStableAnchorOwnership(surfaceBounds, anchorBounds) {
  if (!isBox(surfaceBounds) || !isBox(anchorBounds)) return false;
  const horizontalOverlap = intervalOverlap(
    surfaceBounds.x,
    surfaceBounds.x + surfaceBounds.width,
    anchorBounds.x,
    anchorBounds.x + anchorBounds.width,
  );
  const verticalOverlap = intervalOverlap(
    surfaceBounds.y,
    surfaceBounds.y + surfaceBounds.height,
    anchorBounds.y,
    anchorBounds.y + anchorBounds.height,
  );
  const horizontalGap = axisGap(
    surfaceBounds.x,
    surfaceBounds.x + surfaceBounds.width,
    anchorBounds.x,
    anchorBounds.x + anchorBounds.width,
  );
  const verticalGap = axisGap(
    surfaceBounds.y,
    surfaceBounds.y + surfaceBounds.height,
    anchorBounds.y,
    anchorBounds.y + anchorBounds.height,
  );
  return horizontalOverlap > 0
    || (verticalOverlap > 0 && horizontalGap <= Math.max(24, anchorBounds.width * 0.25))
    || (horizontalGap <= 24 && verticalGap <= 24);
}

function intervalOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function comparablePixelImages(left, right) {
  return isPixelImage(left)
    && isPixelImage(right)
    && left.width === right.width
    && left.height === right.height;
}

function changedPixelRatio(before, after, bounds, threshold = 18) {
  if (!isBox(bounds) || !comparablePixelImages(before, after)) return null;
  let changed = 0;
  const total = Math.max(1, Math.round(bounds.width) * Math.round(bounds.height));
  for (let y = Math.round(bounds.y); y < Math.round(bounds.y + bounds.height); y += 1) {
    for (let x = Math.round(bounds.x); x < Math.round(bounds.x + bounds.width); x += 1) {
      const offset = ((y * before.width) + x) * 4;
      const delta = Math.max(
        Math.abs(before.data[offset] - after.data[offset]),
        Math.abs(before.data[offset + 1] - after.data[offset + 1]),
        Math.abs(before.data[offset + 2] - after.data[offset + 2]),
        Math.abs(before.data[offset + 3] - after.data[offset + 3]),
      );
      if (delta > threshold) changed += 1;
    }
  }
  return changed / total;
}

export function composeOwnedTransientSceneElements({
  mainCapture,
  searchControl,
  navigationControl,
  surfaces = [],
} = {}) {
  if (!isBox(mainCapture)
    || (!isBox(searchControl?.bounds) && !isBox(navigationControl?.bounds))) return [];
  const mainWindowId = String(mainCapture.windowId ?? mainCapture.hwnd ?? "");
  if (mainWindowId === "") return [];

  const elements = [];
  for (const surface of surfaces) {
    if (!isProvenRelatedSurface(surface, mainWindowId)) continue;
    const surfaceKind = isBox(searchControl?.bounds)
      && isSearchOwnedSurface({ mainCapture, searchControl, surface })
      ? "search"
      : isBox(navigationControl?.bounds)
        && isNavigationOwnedSurface({ mainCapture, navigationControl, surface })
        ? "navigation"
        : null;
    if (!surfaceKind) continue;
    const coordinate = surfaceCoordinate(surface, mainWindowId);
    if (!coordinate) continue;
    const relationship = surface.surfaceProvenance.relationship;
    const windowToken = `owned-window:${surface.hwnd}`;
    const surfaceToken = surfaceKind === "search"
      ? `search-results:${surface.hwnd}`
      : `navigation-surface:${surface.hwnd}`;
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
      role: surfaceKind === "search" ? "search-results" : "navigation-surface",
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
    elements.push(...surfaceActionableElements({
      surface,
      parentElementToken: surfaceToken,
      coordinate,
      surfaceKind,
    }));
  }
  return elements;
}

export function composeSameWindowNavigationSceneElements({
  mainCapture,
  navigationControl,
  changedRegion,
  ocrElements = [],
  visualProposals = [],
} = {}) {
  if (!isBox(mainCapture)
    || !isBox(navigationControl?.bounds)
    || !isBox(changedRegion)) return [];
  const mainWindowId = String(mainCapture.windowId ?? mainCapture.hwnd ?? "");
  const screenshotId = String(mainCapture.screenshotId ?? "");
  const mainBounds = { x: 0, y: 0, width: mainCapture.width, height: mainCapture.height };
  if (mainWindowId === ""
    || screenshotId === ""
    || !contains(mainBounds, navigationControl.bounds)
    || !contains(mainBounds, changedRegion)
    || area(changedRegion) < 200
    || area(changedRegion) > area(mainBounds) * 0.75
    || boxGap(navigationControl.bounds, changedRegion) > 160) return [];

  const coordinate = mainWindowCoordinate(mainCapture, mainWindowId, screenshotId);
  if (!coordinate) return [];
  const boundedOcr = (Array.isArray(ocrElements) ? ocrElements : [])
    .filter((element) => isBox(element?.bounds) && contains(changedRegion, element.bounds));
  const boundedVisual = (Array.isArray(visualProposals) ? visualProposals : [])
    .filter((proposal) => isBox(proposal?.bounds) && contains(changedRegion, proposal.bounds));
  const regionId = stableBoxId(changedRegion);
  const surfaceToken = `navigation-surface:${mainWindowId}:${screenshotId}:${regionId}`;
  const syntheticSurface = {
    hwnd: mainWindowId,
    width: mainCapture.width,
    height: mainCapture.height,
    ocrElements: boundedOcr,
    visualProposals: boundedVisual,
  };
  const items = surfaceActionableElements({
    surface: syntheticSurface,
    parentElementToken: surfaceToken,
    coordinate,
    surfaceKind: "navigation",
  }).map((item) => ({
    ...item,
    // These rows are offered with a click action and carry a full fused
    // proposal: two independent providers, their own source region, proposal id,
    // and a fused confidence. Dropping the pixel-limited marker used to leave an
    // element that advertised a click no admission path could ever accept, so
    // the action was refused as ungrounded even though its evidence was intact.
    pixelLimitedAction: true,
    modelIdentity: {
      provider: "local-proposal-fusion",
      model: "same-window-navigation-som-ocr-v1",
    },
  }));
  if (items.length === 0) return [];
  return [{
    hostType: "TransientSurface",
    role: "navigation-surface",
    elementToken: surfaceToken,
    parentSceneRoot: true,
    bounds: { ...changedRegion },
    sourceRegion: { ...changedRegion },
    source: "semantic",
    actions: [],
    coordinate,
    semanticKey: `navigation-surface:${mainWindowId}:${regionId}`,
    support: [{
      provider: "cua-driver-screenshot-diff",
      confidence: 1,
      proposalId: screenshotId,
    }],
  }, ...items];
}

function surfaceActionableElements({ surface, parentElementToken, coordinate, surfaceKind }) {
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
      role: surfaceKind === "search" ? "search-result" : "navigation-item",
      elementToken: `${surfaceKind === "search" ? "search-result" : "navigation-item"}:${surface.hwnd}:${stableBoxId(row.owner.bounds)}:${normalizedName}`,
      parentElementToken,
      bounds: { ...row.owner.bounds },
      sourceRegion: { ...row.owner.bounds },
      source: "local-proposal-fusion",
      modelIdentity: { provider: "local-proposal-fusion", model: "owned-surface-som-ocr-v1" },
      actions: row.conflicting ? [] : ["click"],
      name,
      semanticKey: surfaceKind === "search"
        ? conversationEntitySemanticKey(normalizedName)
        : `navigation:${normalizedName}`,
      confidence,
      proposalId: row.ownerId,
      pixelLimitedAction: true,
      guessedAction: false,
      coordinate,
      support: [{
        provider: row.owner.source === "visual-structure" ? "visual-structure" : "som-proposal",
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

function isNavigationOwnedSurface({ mainCapture, navigationControl, surface }) {
  const navigationScreen = {
    x: mainCapture.x + navigationControl.bounds.x,
    y: mainCapture.y + navigationControl.bounds.y,
    width: navigationControl.bounds.width,
    height: navigationControl.bounds.height,
  };
  const surfaceBounds = {
    x: surface.x,
    y: surface.y,
    width: surface.width,
    height: surface.height,
  };
  const mainBounds = {
    x: mainCapture.x,
    y: mainCapture.y,
    width: mainCapture.width,
    height: mainCapture.height,
  };
  const horizontalGap = axisGap(
    navigationScreen.x,
    navigationScreen.x + navigationScreen.width,
    surfaceBounds.x,
    surfaceBounds.x + surfaceBounds.width,
  );
  const verticalGap = axisGap(
    navigationScreen.y,
    navigationScreen.y + navigationScreen.height,
    surfaceBounds.y,
    surfaceBounds.y + surfaceBounds.height,
  );
  return intersectionArea(mainBounds, surfaceBounds) >= area(surfaceBounds) * 0.5
    && area(surfaceBounds) <= area(mainBounds) * 0.75
    && Math.hypot(horizontalGap, verticalGap) <= 160;
}

function axisGap(leftStart, leftEnd, rightStart, rightEnd) {
  if (leftEnd < rightStart) return rightStart - leftEnd;
  if (rightEnd < leftStart) return leftStart - rightEnd;
  return 0;
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
  const relationship = surface.surfaceProvenance?.relationship;
  const compactSameProcessAuxiliary = relationship !== "same-process-auxiliary"
    || (
      surfaceBounds.width <= mainCapture.width * 0.75
      && surfaceBounds.height <= mainCapture.height * 0.75
    );
  return horizontalOverlap >= Math.min(searchScreen.width, surfaceBounds.width) * 0.5
    && verticalGap >= -12
    && verticalGap <= 64
    && surfaceBounds.height >= 40
    && compactSameProcessAuxiliary;
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

function mainWindowCoordinate(mainCapture, mainWindowId, screenshotId) {
  const transform = mainCapture.coordinateScale?.actionTransform
    ?? { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  if (![transform.scaleX, transform.scaleY, transform.offsetX, transform.offsetY]
    .every(Number.isFinite)) return null;
  return {
    screenshotId,
    windowId: mainWindowId,
    space: "window-local",
    cropOffset: { x: 0, y: 0 },
    scale: {
      x: positiveNumber(mainCapture.coordinateScale?.nativeToObservation?.scaleX, 1),
      y: positiveNumber(mainCapture.coordinateScale?.nativeToObservation?.scaleY, 1),
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

function boxGap(left, right) {
  return Math.hypot(
    axisGap(left.x, left.x + left.width, right.x, right.x + right.width),
    axisGap(left.y, left.y + left.height, right.y, right.y + right.height),
  );
}

function alignedWithAnchor(surface, anchor) {
  const horizontalOffset = Math.abs(
    surface.x + (surface.width / 2) - anchor.x - (anchor.width / 2),
  );
  const verticalOffset = Math.abs(
    surface.y + (surface.height / 2) - anchor.y - (anchor.height / 2),
  );
  if (verticalOffset >= horizontalOffset) {
    return intersectionLength(
      surface.x,
      surface.x + surface.width,
      anchor.x,
      anchor.x + anchor.width,
    ) >= Math.min(surface.width, anchor.width) * 0.25;
  }
  return intersectionLength(
    surface.y,
    surface.y + surface.height,
    anchor.y,
    anchor.y + anchor.height,
  ) >= Math.min(surface.height, anchor.height) * 0.25;
}

function primaryOcrRows(elements, surfaceBounds) {
  const bands = [];
  for (const element of [...elements].sort(compareReadingOrder)) {
    const centerY = element.bounds.y + (element.bounds.height / 2);
    const band = bands.find((candidate) => Math.abs(candidate.centerY - centerY)
      <= Math.max(candidate.height, element.bounds.height) * 0.65);
    if (band) {
      band.elements.push(element);
      band.centerY = band.elements.reduce(
        (sum, item) => sum + item.bounds.y + (item.bounds.height / 2),
        0,
      ) / band.elements.length;
      band.height = Math.max(...band.elements.map((item) => item.bounds.height));
    } else {
      bands.push({ elements: [element], centerY, height: element.bounds.height });
    }
  }
  bands.sort((left, right) => left.centerY - right.centerY);
  return bands.flatMap((band, index) => {
    const label = [...band.elements]
      .sort((left, right) => left.bounds.x - right.bounds.x)
      .find((element) => isMeaningfulNavigationLabel(elementText(element)));
    if (!label) return [];
    const top = index === 0
      ? surfaceBounds.y + 2
      : Math.round((bands[index - 1].centerY + band.centerY) / 2);
    const bottom = index === bands.length - 1
      ? surfaceBounds.y + surfaceBounds.height - 2
      : Math.round((band.centerY + bands[index + 1].centerY) / 2);
    const bounds = {
      x: surfaceBounds.x + 2,
      y: top,
      width: surfaceBounds.width - 4,
      height: bottom - top,
    };
    return isBox(bounds) && bounds.height <= MAX_RESULT_LINE_HEIGHT
      ? [{ label, bounds, centerY: band.centerY }]
      : [];
  });
}

function isMeaningfulNavigationLabel(value) {
  return /\p{L}/u.test(String(value ?? ""));
}

function uniformPixelComponent(pixels, seed, tolerance) {
  const seedColor = pixelColor(pixels, seed.x, seed.y);
  const visited = new Uint8Array(pixels.width * pixels.height);
  const stack = [seed];
  let minX = seed.x;
  let minY = seed.y;
  let maxX = seed.x;
  let maxY = seed.y;
  let count = 0;
  while (stack.length > 0) {
    const point = stack.pop();
    const index = point.y * pixels.width + point.x;
    if (visited[index]) continue;
    visited[index] = 1;
    const color = pixelColor(pixels, point.x, point.y);
    if (Math.max(
      Math.abs(color.r - seedColor.r),
      Math.abs(color.g - seedColor.g),
      Math.abs(color.b - seedColor.b),
    ) > tolerance) continue;
    count += 1;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    if (point.x > 0) stack.push({ x: point.x - 1, y: point.y });
    if (point.x < pixels.width - 1) stack.push({ x: point.x + 1, y: point.y });
    if (point.y > 0) stack.push({ x: point.x, y: point.y - 1 });
    if (point.y < pixels.height - 1) stack.push({ x: point.x, y: point.y + 1 });
  }
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return count > 0 ? { bounds, fillRatio: count / area(bounds) } : null;
}

function pixelColor(pixels, x, y) {
  const offset = (y * pixels.width + x) * 4;
  return {
    r: pixels.data[offset] ?? 0,
    g: pixels.data[offset + 1] ?? 0,
    b: pixels.data[offset + 2] ?? 0,
  };
}

function isPixelImage(value) {
  return value !== null && typeof value === "object"
    && Number.isInteger(value.width) && value.width > 0
    && Number.isInteger(value.height) && value.height > 0
    && value.data?.length >= value.width * value.height * 4;
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
