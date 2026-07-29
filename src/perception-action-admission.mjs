const SEMANTIC_SOURCES = new Set(["cua-driver", "uia", "uia-som", "semantic"]);

export function admitPerceptionAction({ observation, element, action, now = Date.now() } = {}) {
  if (!isRecord(observation) || !isRecord(action)) return denied("observation.insufficient");
  if (observation.includeUserOverlay !== false) return denied("observation.overlay_contaminated");
  if (Number.isFinite(observation.expiresAt) && observation.expiresAt <= now) return denied("observation.expired");
  if (observation.window?.id && action.windowId && String(observation.window.id) !== String(action.windowId)) {
    return denied("observation.window_mismatch");
  }
  if (observation.controllerId && action.controllerId && observation.controllerId !== action.controllerId) {
    return denied("observation.lease_mismatch");
  }
  if (hasPixelCoordinates(action)) {
    if (action.observationId !== observation.observationId) return denied("observation.identity_mismatch");
    if (!["click", "type_text", "press_key"].includes(action.kind)) return denied("observation.insufficient");
    if (action.guessedAction === true || !coordinatesWithinObservation(action, observation)) {
      return denied("observation.insufficient");
    }
    return allowed(true);
  }
  if (!isRecord(element)) return denied("observation.insufficient");
  if (!Array.isArray(element.actions) || !element.actions.includes(action.kind)) return denied("observation.insufficient");

  const pixelLimitedAction = element.pixelLimitedAction === true;
  if (!pixelLimitedAction && SEMANTIC_SOURCES.has(element.source ?? observation.source)) {
    return allowed(false);
  }
  if (!pixelLimitedAction) return denied("observation.insufficient");
  if (element.passwordRegion === true || element.paymentRegion === true || element.privateRegion === true) {
    return denied("policy.sensitive_region");
  }
  if (!isBox(element.sourceRegion) || !isRecord(element.modelIdentity)
    || typeof element.modelIdentity.provider !== "string"
    || typeof element.proposalId !== "string" || element.proposalId.trim() === "") {
    return denied("observation.insufficient");
  }
  if (!Number.isFinite(element.confidence) || element.confidence < 0.98 || element.guessedAction === true) {
    return denied("observation.insufficient");
  }
  const support = Array.isArray(element.support) ? element.support : [];
  const providers = new Set(support
    .filter((entry) => typeof entry?.provider === "string" && Number.isFinite(entry.confidence))
    .map((entry) => entry.provider));
  const exactTemplate = element.source === "template"
    && element.exact === true
    && element.approvedActionLabel === true
    && providers.has("template");
  const fused = element.source === "local-proposal-fusion" && providers.size >= 2;
  const exactOcr = element.source === "ocr"
    && action.kind === "click"
    && providers.size === 1
    && providers.has("ocr")
    && typeof element.name === "string"
    && element.name.trim() !== ""
    && typeof element.rawTextSha256 === "string"
    && element.rawTextSha256.length === 64;
  return exactTemplate || fused || exactOcr ? allowed(true) : denied("observation.insufficient");
}

function allowed(pixelLimitedAction) {
  return Object.freeze({ allowed: true, code: "action.allowed", pixelLimitedAction });
}

function denied(code) {
  return Object.freeze({ allowed: false, code, pixelLimitedAction: false });
}

function isBox(value) {
  return isRecord(value)
    && Number.isFinite(value.x) && value.x >= 0
    && Number.isFinite(value.y) && value.y >= 0
    && Number.isFinite(value.width) && value.width > 0
    && Number.isFinite(value.height) && value.height > 0;
}

function hasPixelCoordinates(action) {
  return Number.isFinite(action?.x) && Number.isFinite(action?.y);
}

function coordinatesWithinObservation(action, observation) {
  const width = observation.capture?.width ?? observation.window?.bounds?.width;
  const height = observation.capture?.height ?? observation.window?.bounds?.height;
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    && action.x >= 0 && action.x < width
    && action.y >= 0 && action.y < height;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
