const EVIDENCE_SOURCES = new Set(["ocr", "structure", "visual"]);
const HOST_ELEMENT_TYPES = new Set([
  "Window",
  "Container",
  "Editable",
  "TransientSurface",
  "ActionableItem",
]);
const STRUCTURE_SOURCES = new Set(["cua-driver", "uia", "uia-som", "semantic"]);
const OCR_SOURCES = new Set(["ocr", "ocr-cache"]);
const TRANSIENT_ROLES = new Set([
  "alert",
  "combo-box-popup",
  "dialog",
  "list",
  "menu",
  "popup",
  "tooltip",
]);
const EDITABLE_ROLES = new Set([
  "editable",
  "edit",
  "input",
  "search-box",
  "textbox",
  "text-field",
]);

/**
 * Project every Host observation into one authoritative Scene. Raw provider
 * elements remain implementation evidence; callers act through Scene ids.
 */
export function buildHostScene({ observation, observationVersion } = {}) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    throw sceneError("scene.invalid_observation", "A Host observation is required.");
  }
  const version = Number.isInteger(observationVersion)
    ? observationVersion
    : observation.surfaceReceipt?.generation;
  if (!Number.isInteger(version) || version < 0) {
    throw sceneError("scene.invalid_observation_version", "A non-negative observation version is required.");
  }

  const observationId = requiredString(observation.observationId, "scene.invalid_observation");
  const windowId = requiredString(
    observation.window?.id ?? observation.surfaceReceipt?.windowId,
    "scene.invalid_window",
  );
  const screenshotId = String(
    observation.surfaceReceipt?.screenshotId
      ?? observation.capture?.screenshotId
      ?? observationId,
  );
  const coordinateSpace = requiredString(
    observation.coordinateSpace ?? "window-local",
    "scene.invalid_coordinate_space",
  );
  const coordinateBounds = normalizeBounds(
    inferObservationBounds(observation),
    "scene.invalid_coordinate_bounds",
  );
  const transform = observation.coordinateScale?.actionTransform ?? {};
  const crop = observation.capture ?? observation.crop ?? {};
  const coordinate = Object.freeze({
    screenshotId,
    windowId,
    space: coordinateSpace,
    cropOffset: Object.freeze({
      x: finiteOr(crop.x, transform.offsetX, 0),
      y: finiteOr(crop.y, transform.offsetY, 0),
    }),
    scale: Object.freeze({
      x: positiveOr(transform.scaleX, 1),
      y: positiveOr(transform.scaleY, 1),
    }),
    bounds: Object.freeze({ ...coordinateBounds }),
  });

  const sceneId = `scene:${windowId}:${version}`;
  const windowElementId = `${sceneId}:window`;
  const viewportElementId = `${sceneId}:viewport`;
  const elements = [
    hostElement({
      id: windowElementId,
      type: "Window",
      role: observation.window?.role ?? "main-window",
      parentId: null,
      observationVersion: version,
      coordinate,
      evidence: [{ source: "structure", detail: "controller-window" }],
      actions: ["activate_window"],
      name: observation.window?.title ?? null,
      state: {
        foreground: observation.window?.isForeground === true
          || observation.window?.foreground === true,
      },
    }),
    hostElement({
      id: viewportElementId,
      type: "Container",
      role: "observation-viewport",
      parentId: windowElementId,
      observationVersion: version,
      coordinate,
      evidence: [{ source: "structure", detail: "observation-bounds" }],
      actions: [],
    }),
  ];

  const regionParents = buildObservationRegions({
    observation,
    sceneId,
    viewportElementId,
    observationVersion: version,
    coordinate,
  });
  elements.push(...regionParents.elements);

  const rawElements = collectProviderElements(observation);
  const rawElementIds = rawElements.map((raw, index) => sceneElementId(sceneId, index));
  const rawElementIdByToken = new Map(rawElements.flatMap((raw, index) => {
    const token = raw?.elementToken ?? raw?.element_token;
    return token === undefined || token === null ? [] : [[String(token), rawElementIds[index]]];
  }));
  for (let index = 0; index < rawElements.length; index += 1) {
    const raw = rawElements[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const source = evidenceSource(raw.source ?? observation.source);
    const bounds = providerElementBounds(raw, observation, coordinateBounds);
    const parentId = structuralParentId(raw, rawElementIds, rawElementIdByToken)
      ?? regionParents.parentFor(bounds)
      ?? viewportElementId;
    const evidence = evidenceForRawElement(raw, source, parentId, bounds);
    const conflicts = normalizeConflicts(raw);
    const evidenceConsistency = conflicts.length > 0
      ? "conflict"
      : providerEvidenceSufficient(raw, source)
        ? "consistent"
        : "insufficient";
    const declaredActions = uniqueStrings(raw.actions);
    const actions = evidenceConsistency === "consistent"
      ? declaredActions
      : [];
    const id = sceneElementId(sceneId, index);
    elements.push(hostElement({
      id,
      type: hostTypeFor(raw, source),
      role: typeof raw.role === "string" && raw.role.trim() ? raw.role : "observed-item",
      parentId,
      observationVersion: version,
      coordinate: coordinateWithBounds(coordinate, bounds ?? coordinateBounds),
      evidence,
      evidenceConsistency,
      conflicts,
      actions,
      name: typeof raw.name === "string" ? raw.name : null,
      value: typeof raw.value === "string" ? raw.value : null,
      state: normalizeElementState(raw.state),
      semanticKey: typeof raw.semanticKey === "string" && raw.semanticKey.trim()
        ? raw.semanticKey
        : null,
      binding: {
        providerElementIndex: index,
        ...(typeof raw.elementToken === "string" ? { elementToken: raw.elementToken } : {}),
        pixelLimitedAction: raw.pixelLimitedAction === true,
      },
    }));
  }

  return Object.freeze({
    id: sceneId,
    observationId,
    observationVersion: version,
    screenshotId,
    windowId,
    rootId: windowElementId,
    elements: Object.freeze(elements),
  });
}

export function resolveHostSceneElement(scene, action = {}) {
  if (!scene || !Array.isArray(scene.elements)) return null;
  if (typeof action.elementId === "string") {
    return scene.elements.find((element) => element.id === action.elementId) ?? null;
  }
  if (typeof action.elementToken === "string") {
    return scene.elements.find((element) => element.binding?.elementToken === action.elementToken) ?? null;
  }
  if (Number.isSafeInteger(action.elementIndex) && action.elementIndex >= 0) {
    return scene.elements.find(
      (element) => element.binding?.providerElementIndex === action.elementIndex,
    ) ?? null;
  }
  return null;
}

export function buildRegionOwnedScene({ screenshot, regions = [], evidence = [] } = {}) {
  const normalizedScreenshot = normalizeScreenshot(screenshot);
  const regionMap = new Map();

  for (const region of regions) {
    const normalized = normalizeRegion(region, normalizedScreenshot);
    if (regionMap.has(normalized.id)) {
      throw sceneError("scene.duplicate_region", `Duplicate scene region: ${normalized.id}`);
    }
    regionMap.set(normalized.id, normalized);
  }

  const evidenceByClaim = new Map();
  for (const item of evidence) {
    const normalized = normalizeEvidence(item, regionMap);
    const claims = evidenceByClaim.get(normalized.claimId) ?? [];
    claims.push(normalized);
    evidenceByClaim.set(normalized.claimId, claims);
  }

  const elements = [...evidenceByClaim.entries()].map(([claimId, claims]) => (
    projectClaim(claimId, claims, normalizedScreenshot)
  ));

  const regionValues = {};
  for (const region of regionMap.values()) {
    if (region.role !== "editable") continue;
    const ownedText = evidence
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.source === "ocr" && item.regionId === region.id)
      .map(({ item, index }) => ({
        index,
        text: item.text,
        bounds: normalizeBounds(item.bounds, "scene.invalid_evidence_bounds"),
      }))
      .sort(compareReadingOrder)
      .map(({ text }) => text)
      .filter((text) => typeof text === "string" && text.length > 0);
    regionValues[region.id] = ownedText.join(" ");
  }

  return {
    id: `${normalizedScreenshot.id}:${normalizedScreenshot.observationVersion}`,
    screenshot: normalizedScreenshot,
    regions: [...regionMap.values()],
    elements,
    regionValues,
  };
}

function normalizeScreenshot(screenshot) {
  if (!screenshot || typeof screenshot !== "object") {
    throw sceneError("scene.invalid_screenshot", "A screenshot descriptor is required.");
  }
  for (const key of ["id", "windowId", "coordinateSpace"]) {
    if (typeof screenshot[key] !== "string" || screenshot[key].length === 0) {
      throw sceneError("scene.invalid_screenshot", `Screenshot ${key} is required.`);
    }
  }
  if (!Number.isInteger(screenshot.observationVersion) || screenshot.observationVersion < 0) {
    throw sceneError("scene.invalid_screenshot", "Screenshot observationVersion must be a non-negative integer.");
  }
  return {
    id: screenshot.id,
    windowId: screenshot.windowId,
    observationVersion: screenshot.observationVersion,
    coordinateSpace: screenshot.coordinateSpace,
    bounds: normalizeBounds(screenshot.bounds, "scene.invalid_screenshot"),
    cropOffset: normalizePoint(screenshot.cropOffset, "scene.invalid_screenshot"),
    scale: normalizeScale(screenshot.scale),
  };
}

function normalizeRegion(region, screenshot) {
  if (!region || typeof region.id !== "string" || region.id.length === 0) {
    throw sceneError("scene.invalid_region", "Every region requires an id.");
  }
  if (typeof region.role !== "string" || region.role.length === 0) {
    throw sceneError("scene.invalid_region", `Region ${region.id} requires a role.`);
  }
  const bounds = normalizeBounds(region.bounds, "scene.invalid_region");
  if (!contains(screenshot.bounds, bounds)) {
    throw sceneError("scene.region_outside_screenshot", `Region ${region.id} is outside its screenshot.`);
  }
  return { id: region.id, role: region.role, bounds };
}

function normalizeEvidence(item, regionMap) {
  if (!item || typeof item.claimId !== "string" || item.claimId.length === 0) {
    throw sceneError("scene.invalid_evidence", "Every evidence item requires a claimId.");
  }
  if (!EVIDENCE_SOURCES.has(item.source)) {
    throw sceneError("scene.invalid_evidence_source", `Unsupported evidence source: ${item.source}`);
  }
  const region = regionMap.get(item.regionId);
  if (!region) {
    throw sceneError("scene.unknown_parent", `Evidence ${item.claimId} refers to an unknown parent region.`);
  }
  const bounds = normalizeBounds(item.bounds, "scene.invalid_evidence_bounds");
  if (!contains(region.bounds, bounds)) {
    throw sceneError(
      "scene.evidence_outside_parent",
      `Evidence ${item.claimId} is outside its declared parent ${region.id}.`,
    );
  }
  return {
    claimId: item.claimId,
    source: item.source,
    regionId: region.id,
    role: typeof item.role === "string" && item.role.length > 0 ? item.role : "observed-text",
    text: typeof item.text === "string" ? item.text : null,
    bounds,
    actions: Array.isArray(item.actions) ? [...new Set(item.actions.filter((action) => typeof action === "string"))] : [],
  };
}

function projectClaim(claimId, claims, screenshot) {
  const first = claims[0];
  const conflicts = [];
  if (claims.some((claim) => claim.regionId !== first.regionId)) conflicts.push("parent");
  if (claims.some((claim) => claim.role !== first.role)) conflicts.push("role");
  if (claims.some((claim) => !equalBounds(claim.bounds, first.bounds))) conflicts.push("bounds");
  if (claims.some((claim) => claim.text !== first.text)) conflicts.push("text");

  const evidenceConsistency = conflicts.length === 0 ? "consistent" : "conflict";
  const structured = claims.filter((claim) => claim.source === "structure");
  const actions = evidenceConsistency === "consistent"
    ? [...new Set(structured.flatMap((claim) => claim.actions))]
    : [];

  return {
    id: claimId,
    role: first.role,
    parentId: first.regionId,
    text: first.text,
    bounds: first.bounds,
    screenshotId: screenshot.id,
    windowId: screenshot.windowId,
    observationVersion: screenshot.observationVersion,
    coordinateSpace: screenshot.coordinateSpace,
    cropOffset: screenshot.cropOffset,
    scale: screenshot.scale,
    evidence: claims.map((claim) => ({
      source: claim.source,
      parentId: claim.regionId,
      role: claim.role,
      text: claim.text,
      bounds: claim.bounds,
    })),
    evidenceConsistency,
    conflicts,
    actions,
    actionable: actions.length > 0,
    invalidatesOn: ["new-observation", "window-change", "parent-change", "coordinate-transform-change"],
  };
}

function normalizeBounds(bounds, code) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width < 0 || bounds.height < 0) {
    throw sceneError(code, "Bounds must contain finite x, y, width, and height values.");
  }
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function normalizePoint(point, code) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw sceneError(code, "A finite cropOffset is required.");
  }
  return { x: point.x, y: point.y };
}

function normalizeScale(scale) {
  if (!scale || !Number.isFinite(scale.x) || !Number.isFinite(scale.y) || scale.x <= 0 || scale.y <= 0) {
    throw sceneError("scene.invalid_screenshot", "Positive finite screenshot scale values are required.");
  }
  return { x: scale.x, y: scale.y };
}

function contains(parent, child) {
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.width <= parent.x + parent.width
    && child.y + child.height <= parent.y + parent.height;
}

function equalBounds(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function compareReadingOrder(left, right) {
  return left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x
    || left.index - right.index;
}

function sceneError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function buildObservationRegions({
  observation,
  sceneId,
  viewportElementId,
  observationVersion,
  coordinate,
}) {
  const candidates = [
    ["ocr-primary", observation.perceptionRouting?.ocrRegion ?? observation.localObservation?.crop],
    ["ocr-secondary", observation.perceptionRouting?.secondaryOcrRegion],
    ["visual", observation.perceptionRouting?.visualRegion],
  ];
  const regions = [];
  const elements = [];
  for (const [role, value] of candidates) {
    const bounds = optionalBounds(value);
    if (!bounds || regions.some((region) => equalBounds(region.bounds, bounds))) continue;
    const id = `${sceneId}:container:${role}`;
    regions.push({ id, bounds });
    elements.push(hostElement({
      id,
      type: "Container",
      role,
      parentId: viewportElementId,
      observationVersion,
      coordinate: coordinateWithBounds(coordinate, bounds),
      evidence: [{ source: "structure", detail: "host-declared-region" }],
      actions: [],
    }));
  }
  return {
    elements,
    parentFor(bounds) {
      if (!bounds) return null;
      const containing = regions
        .filter((region) => contains(region.bounds, bounds))
        .sort((left, right) => area(left.bounds) - area(right.bounds));
      return containing[0]?.id ?? null;
    },
  };
}

function hostElement({
  id,
  type,
  role,
  parentId,
  observationVersion,
  coordinate,
  evidence,
  evidenceConsistency = "consistent",
  conflicts = [],
  actions,
  name = null,
  value = null,
  state = {},
  semanticKey = null,
  binding,
}) {
  if (!HOST_ELEMENT_TYPES.has(type)) {
    throw sceneError("scene.invalid_element_type", `Unsupported Host element type: ${type}`);
  }
  const executableActions = evidenceConsistency === "consistent" ? uniqueStrings(actions) : [];
  return Object.freeze({
    id,
    type,
    role,
    parentId,
    observationVersion,
    coordinate,
    evidence: Object.freeze(evidence.map((item) => Object.freeze({ ...item }))),
    evidenceConsistency,
    conflicts: Object.freeze([...conflicts]),
    actions: Object.freeze(executableActions),
    actionable: executableActions.length > 0,
    invalidatesOn: Object.freeze([
      "new-observation",
      "window-change",
      "parent-change",
      "coordinate-transform-change",
    ]),
    ...(name !== null ? { name } : {}),
    ...(value !== null ? { value } : {}),
    state: Object.freeze({ ...state }),
    ...(semanticKey !== null ? { semanticKey } : {}),
    ...(binding ? { binding: Object.freeze({ ...binding }) } : {}),
  });
}

function structuralParentId(raw, rawElementIds, rawElementIdByToken) {
  const parentToken = raw.parentElementToken ?? raw.parentToken
    ?? raw.parent_element_token ?? raw.parent_token;
  if (parentToken !== undefined && parentToken !== null) {
    return rawElementIdByToken.get(String(parentToken)) ?? null;
  }
  const parentIndex = raw.parentElementIndex ?? raw.parentIndex
    ?? raw.parent_element_index ?? raw.parent_index;
  return Number.isSafeInteger(parentIndex) && parentIndex >= 0
    ? rawElementIds[parentIndex] ?? null
    : null;
}

function normalizeElementState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return { ...state };
}

function collectProviderElements(observation) {
  const direct = Array.isArray(observation.elements) ? observation.elements : [];
  const nested = Array.isArray(observation.observation?.elements)
    ? observation.observation.elements
    : [];
  const local = Array.isArray(observation.localObservation?.elements)
    ? observation.localObservation.elements
    : [];
  const seen = new Set();
  return [...direct, ...nested, ...local].filter((element) => {
    if (!element || typeof element !== "object") return false;
    if (seen.has(element)) return false;
    seen.add(element);
    return true;
  });
}

function evidenceForRawElement(raw, source, parentId, bounds) {
  const evidence = [{
    source,
    parentId,
    role: raw.role ?? null,
    bounds,
  }];
  for (const support of Array.isArray(raw.support) ? raw.support : []) {
    const normalizedSource = evidenceSource(support?.provider);
    if (evidence.some((item) => item.source === normalizedSource)) continue;
    evidence.push({
      source: normalizedSource,
      parentId,
      role: raw.role ?? null,
      bounds,
    });
  }
  return evidence;
}

function evidenceSource(source) {
  if (STRUCTURE_SOURCES.has(source)) return "structure";
  if (OCR_SOURCES.has(source)) return "ocr";
  return "visual";
}

function providerEvidenceSufficient(raw, source) {
  if (source === "structure") return true;
  if (raw.source === "template" && raw.exact === true && raw.approvedActionLabel === true) return true;
  if (raw.source !== "local-proposal-fusion") return false;
  const providers = new Set((Array.isArray(raw.support) ? raw.support : [])
    .map((item) => item?.provider)
    .filter((provider) => typeof provider === "string" && provider.trim() !== ""));
  return providers.size >= 2;
}

function hostTypeFor(raw, source) {
  const role = String(raw.role ?? "").trim().toLowerCase();
  if (source === "structure" && EDITABLE_ROLES.has(role)) return "Editable";
  if (source === "structure" && TRANSIENT_ROLES.has(role)) return "TransientSurface";
  if (source === "structure" && (!Array.isArray(raw.actions) || raw.actions.length === 0)) {
    return "Container";
  }
  return "ActionableItem";
}

function sceneElementId(sceneId, index) {
  return `${sceneId}:element:${index}`;
}

function coordinateWithBounds(coordinate, bounds) {
  return Object.freeze({
    ...coordinate,
    bounds: Object.freeze({ ...bounds }),
  });
}

function normalizeConflicts(raw) {
  if (raw.evidenceConsistency === "conflict") {
    return uniqueStrings(raw.conflicts).length > 0
      ? uniqueStrings(raw.conflicts)
      : ["provider-declared-conflict"];
  }
  return uniqueStrings(raw.conflicts);
}

function optionalBounds(bounds) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width < 0 || bounds.height < 0) return null;
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

function providerElementBounds(raw, observation, coordinateBounds) {
  const bounds = optionalBounds(raw.bounds ?? raw.sourceRegion);
  if (!bounds || contains(coordinateBounds, bounds)) return bounds;
  const windowBounds = observation.window?.bounds;
  if (!Number.isFinite(windowBounds?.x) || !Number.isFinite(windowBounds?.y)) return bounds;
  const projected = {
    ...bounds,
    x: bounds.x - windowBounds.x,
    y: bounds.y - windowBounds.y,
  };
  return contains(coordinateBounds, projected) ? projected : bounds;
}

function inferObservationBounds(observation) {
  const candidates = [
    observation.coordinateBounds,
    observation.localObservation?.coordinateBounds,
    observation.capture && {
      x: 0,
      y: 0,
      width: observation.capture.width,
      height: observation.capture.height,
    },
    observation.window?.bounds && {
      x: 0,
      y: 0,
      width: observation.window.bounds.width,
      height: observation.window.bounds.height,
    },
    observation.crop && {
      x: 0,
      y: 0,
      width: observation.crop.width,
      height: observation.crop.height,
    },
  ];
  for (const candidate of candidates) {
    const normalized = optionalBounds(candidate);
    if (normalized) return normalized;
  }
  const elementBounds = collectProviderElements(observation)
    .map((element) => optionalBounds(element?.bounds ?? element?.sourceRegion))
    .filter(Boolean);
  if (elementBounds.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: 0,
    y: 0,
    width: Math.max(...elementBounds.map((bounds) => bounds.x + bounds.width)),
    height: Math.max(...elementBounds.map((bounds) => bounds.y + bounds.height)),
  };
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") {
    throw sceneError(code, "A non-empty string is required.");
  }
  return value;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim() !== ""))];
}

function finiteOr(...values) {
  return values.find(Number.isFinite) ?? 0;
}

function positiveOr(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function area(bounds) {
  return bounds.width * bounds.height;
}
