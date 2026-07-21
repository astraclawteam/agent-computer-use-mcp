const LAB_REQUIRED_ROLES = new Set(["textbox", "button", "text", "list"]);

export function normalizeCuaObservation(raw, options = {}) {
  const elements = (raw.elements ?? []).map((element, index) => normalizeElement(element, index));
  const status = elements.find((element) => element.name === "Status" && element.value);
  const text = status ? `Status="${status.value}"` : (raw.text ?? "");

  return {
    observationId: options.observationId ?? `obs-${Date.now()}`,
    provider: "gateway-managed",
    source: "cua-driver",
    mode: options.mode ?? "som",
    window: raw.window,
    elements,
    text,
    includeUserOverlay: false,
  };
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
