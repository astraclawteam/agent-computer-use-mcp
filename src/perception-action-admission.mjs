const SEMANTIC_SOURCES = new Set(["cua-driver", "uia", "uia-som", "semantic"]);

export function admitPerceptionAction({ observation, element, action, now = Date.now() } = {}) {
  if (!isRecord(action)) return denied("observation.insufficient");
  if (action.kind === "activate_window") return allowed(false);
  if ((action.kind === "press_key" || action.kind === "type_text") && !hasPixelCoordinates(action)
    && action.elementToken === undefined && action.elementIndex === undefined) {
    if (typeof action.focusReceiptId !== "string" || action.focusReceiptId.trim() === "") {
      return denied("focus.receipt_required");
    }
    return allowed(false);
  }
  if (!isRecord(observation)) return denied("observation.insufficient");
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
    if (action.kind === "click" && action.targetRole === "editable") {
      return denied("target.editable_click_requires_text", {
        reason: "Editable surfaces are focused and written atomically; a separate focus click is not an admissible public action.",
        targetRole: "editable",
        requiredActionKind: "type_text",
        nextAction: "Reuse this same fresh screenshot observationId and targetBounds in one type_text action with value, textMode, and inputBehavior. Do not observe or click first.",
      });
    }
    if (action.kind === "click" && !isPixelClickIntent(action.interactionIntent)) {
      return denied("target.interaction_intent_required", {
        allowedInteractionIntents: [
          "activate-recognized-text",
          "focus-editable",
          "activate-control",
          "select-item",
        ],
        nextAction: "Declare what the pixel click is intended to do. A click whose purpose is text focus must use focus-editable and screenshot-grounded editable-interior geometry.",
      });
    }
    if (action.kind === "click"
      && isOcrTextGeometry(observation)
      && action.interactionIntent !== "activate-recognized-text") {
      return denied("target.visual_grounding_required", {
        reason: "OCR geometry can activate recognized text, but it cannot prove a control interior, list-item interior, or editable focus surface.",
        rejectedGrounding: "ocr-recognized-text",
        interactionIntent: action.interactionIntent,
        requiredObservationMode: "screenshot",
        nextAction: "Capture a fresh screenshot and visually ground the intended control interior before clicking.",
      });
    }
    if ((action.kind === "type_text" || action.kind === "press_key")
      && isOcrTextGeometry(observation)) {
      return denied("target.editable_interior_required", {
        reason: "OCR coordinates identify recognized glyph geometry, not the parent control's editable interior.",
        rejectedGrounding: "ocr-recognized-text",
        requiredObservationMode: "screenshot",
        requiredGrounding: "editable-interior",
        nextAction: "Capture a fresh screenshot, ask the Host image-understanding path for a point strictly inside the intended editable surface (excluding icons, labels, borders, and affordances), then use that screenshot observationId and projected point in one type_text action.",
      });
    }
    if (requiresEditableTargetBounds(action)
      && (!isBox(action.targetBounds)
        || !boxWithinObservation(action.targetBounds, observation)
        || !pointWithinSafeTargetCore(action, action.targetBounds))) {
      return denied("target.editable_interior_required", {
        reason: "Coordinate-grounded text focus requires the full editable surface rectangle and a point inside its central safe region.",
        requiredGrounding: "editable-surface-bounds",
        safePointRule: "Use the rectangle center; exclude placeholder glyphs, borders, icons, and adjacent affordances.",
        nextAction: "Capture a fresh screenshot, derive the full editable surface rectangle, set targetBounds in the observation coordinate space, and place x/y near its center. The Host executes at the validated rectangle center.",
      });
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
    && action.interactionIntent === "activate-recognized-text"
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

function denied(code, detail = {}) {
  return Object.freeze({ allowed: false, code, pixelLimitedAction: false, ...detail });
}

function isOcrTextGeometry(observation) {
  return observation.source === "ocr" || observation.mode === "ocr";
}

function isPixelClickIntent(value) {
  return value === "activate-recognized-text"
    || value === "focus-editable"
    || value === "activate-control"
    || value === "select-item";
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

function requiresEditableTargetBounds(action) {
  return action.kind === "type_text"
    || (action.kind === "click" && action.interactionIntent === "focus-editable");
}

function boxWithinObservation(box, observation) {
  const width = observation.capture?.width ?? observation.window?.bounds?.width;
  const height = observation.capture?.height ?? observation.window?.bounds?.height;
  return Number.isFinite(width) && width > 0
    && Number.isFinite(height) && height > 0
    && box.x >= 0
    && box.y >= 0
    && box.x + box.width <= width
    && box.y + box.height <= height;
}

function pointWithinSafeTargetCore(action, box) {
  const horizontalInset = box.width * 0.2;
  const verticalInset = box.height * 0.2;
  return action.x >= box.x + horizontalInset
    && action.x <= box.x + box.width - horizontalInset
    && action.y >= box.y + verticalInset
    && action.y <= box.y + box.height - verticalInset;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
