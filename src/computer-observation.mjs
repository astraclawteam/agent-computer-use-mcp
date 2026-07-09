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
  return {
    elementToken: String(element.elementToken ?? element.element_token ?? element.id ?? element.token ?? index + 1),
    elementIndex: element.elementIndex ?? element.element_index ?? index,
    role: String(element.role ?? element.type ?? "unknown").toLowerCase(),
    name: String(element.name ?? element.label ?? element.title ?? ""),
    value: element.value == null ? "" : String(element.value),
    state: element.state ?? {},
    actions: element.actions ?? [],
    bounds: element.bounds ?? element.frame,
    confidence: element.confidence ?? 1,
    source: element.source ?? "cua-driver",
  };
}
