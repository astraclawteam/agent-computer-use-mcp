const LAB_REQUIRED_ROLES = new Set(["textbox", "button", "text", "list"]);

export function normalizeCuaObservation(raw, options = {}) {
  const elements = (raw.elements ?? []).map((element, index) => normalizeElement(element, index));
  const status = elements.find((element) => element.name === "Status" && element.value);
  const text = status ? `Status="${status.value}"` : (raw.text ?? "");
  const focusedElement = findFocusedElement(raw, elements);
  const truncation = normalizeTruncation(raw, elements, options);

  return {
    observationId: options.observationId ?? `obs-${Date.now()}`,
    provider: "gateway-managed",
    source: "cua-driver",
    mode: options.mode ?? "som",
    window: raw.window,
    elements,
    focusedElement,
    truncation,
    text,
    includeUserOverlay: false,
  };
}

function findFocusedElement(raw, elements) {
  const focusedToken = raw.focusedElementToken ?? raw.focused_element_token;
  const focusedIndex = raw.focusedElementIndex ?? raw.focused_element_index
    ?? raw.focusedElementId ?? raw.focused_element_id;
  const element = elements.find((candidate) => (
    (focusedToken !== undefined && candidate.elementToken === String(focusedToken))
    || (Number.isSafeInteger(focusedIndex) && candidate.elementIndex === focusedIndex)
    || candidate.state?.focused === true
    || candidate.state?.hasKeyboardFocus === true
  ));
  if (!element) return null;
  return {
    elementToken: element.elementToken,
    elementIndex: element.elementIndex,
    role: element.role,
    name: element.name,
    source: element.source,
  };
}

function normalizeTruncation(raw, elements, options) {
  const provider = raw.truncation && typeof raw.truncation === "object"
    ? raw.truncation
    : {};
  const maxElements = positiveInteger(options.maxElements ?? provider.maxElements ?? provider.max_elements);
  const maxDepth = positiveInteger(options.maxDepth ?? provider.maxDepth ?? provider.max_depth);
  const elementLimitReached = raw.elementsTruncated === true
    || raw.elements_truncated === true
    || raw.maxElementsReached === true
    || raw.max_elements_reached === true
    || provider.elementLimitReached === true
    || provider.element_limit_reached === true
    || Boolean(maxElements && elements.length >= maxElements);
  const depthLimitReached = raw.maxDepthReached === true
    || raw.max_depth_reached === true
    || provider.depthLimitReached === true
    || provider.depth_limit_reached === true;
  const truncated = raw.truncated === true
    || provider.truncated === true
    || elementLimitReached
    || depthLimitReached;
  return {
    truncated,
    elementLimitReached,
    depthLimitReached,
    returnedElements: elements.length,
    maxElements,
    maxDepth,
  };
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function assertLabObservationSufficient(observation) {
  const roles = new Set(observation.elements.map((element) => element.role));
  for (const role of LAB_REQUIRED_ROLES) {
    if (!roles.has(role)) {
      throw new Error(`observation.insufficient: missing ${role}`);
    }
  }
}

function normalizeElement(element, index) {
  const role = String(element.role ?? element.type ?? "unknown").toLowerCase();
  return {
    elementToken: String(element.elementToken ?? element.element_token ?? element.id ?? element.token ?? index + 1),
    elementIndex: element.elementIndex ?? element.element_index ?? index,
    role,
    name: String(element.name ?? element.label ?? element.title ?? ""),
    value: element.value == null ? "" : String(element.value),
    state: element.state ?? {},
    ...((element.semanticKey ?? element.semantic_key) !== undefined
      && (element.semanticKey ?? element.semantic_key) !== null
      ? { semanticKey: String(element.semanticKey ?? element.semantic_key) }
      : {}),
    ...((element.parentElementToken ?? element.parent_element_token
      ?? element.parentToken ?? element.parent_token) !== undefined
      && (element.parentElementToken ?? element.parent_element_token
        ?? element.parentToken ?? element.parent_token) !== null
      ? {
        parentElementToken: String(
          element.parentElementToken ?? element.parent_element_token
          ?? element.parentToken ?? element.parent_token,
        ),
      }
      : {}),
    ...(Number.isSafeInteger(element.parentElementIndex ?? element.parent_element_index
      ?? element.parentIndex ?? element.parent_index)
      ? {
        parentElementIndex: element.parentElementIndex ?? element.parent_element_index
          ?? element.parentIndex ?? element.parent_index,
      }
      : {}),
    actions: normalizeActions(element.actions, role),
    bounds: normalizeBounds(element.bounds ?? element.frame),
    confidence: element.confidence ?? 1,
    source: element.source ?? "cua-driver",
  };
}

function normalizeActions(actions, role) {
  if (Array.isArray(actions) && actions.length > 0) return actions;
  if (["edit", "textbox"].includes(role)) return ["set_value"];
  if (role === "document") return ["type_text"];
  if (["button", "menuitem", "link", "checkbox", "radio"].includes(role)) return ["click"];
  return [];
}

function normalizeBounds(bounds) {
  if (!bounds) return bounds;
  const x = Number(bounds.x ?? bounds.left ?? 0);
  const y = Number(bounds.y ?? bounds.top ?? 0);
  return {
    x,
    y,
    width: Number(bounds.width ?? bounds.w ?? ((bounds.right ?? x) - x)),
    height: Number(bounds.height ?? bounds.h ?? ((bounds.bottom ?? y) - y)),
  };
}
