import { scheduleOcrRegion } from "./ocr-region-scheduler.mjs";

export const PERCEPTION_STRATEGY_ORDER = [
  "uia-som-semantic",
  "dirty-region-ocr",
  "template-cv",
  "som-proposal",
  "optional-vlm",
];

export function selectPerceptionStrategy(options = {}) {
  const mode = options.mode ?? "action-loop";
  const capabilities = normalizeCapabilities(options.capabilities);
  const windowRef = normalizeWindow(options.window);
  const base = {
    mode,
    window: windowRef,
    fullWindowOcr: false,
    includeUserOverlay: false,
    startsDesktopControl: false,
    uploadsImage: false,
    pixelLimitedAction: false,
    vlm: {
      allowed: false,
      requiresApproval: false,
    },
  };

  if (hasActionableSemanticElements(options.semanticObservation)) {
    return {
      ...base,
      status: "selected",
      strategy: "uia-som-semantic",
      reason: "semantic-elements-actionable",
      providers: ["uia-som"],
      request: null,
      cache: null,
    };
  }

  if (capabilities.ocr && (options.dirtyRegion || options.regionHint)) {
    const ocrPlan = scheduleOcrRegion({
      mode,
      window: windowRef,
      imagePath: options.imagePath,
      image: options.image,
      dirtyRegion: options.dirtyRegion,
      regionHint: options.regionHint,
      modelPackId: options.modelPackId,
      languages: options.languages,
      timeoutMs: options.timeoutMs,
      cacheTtlMs: options.cacheTtlMs,
    });
    return {
      ...base,
      status: ocrPlan.status === "scheduled" ? "selected" : "insufficient",
      strategy: ocrPlan.strategy,
      reason: ocrPlan.reason,
      providers: enabledLocalFallbackProviders({ ocr: true, capabilities }),
      request: ocrPlan.request,
      cache: ocrPlan.cache,
      fullWindowOcr: ocrPlan.fullWindowOcr,
    };
  }

  if (capabilities.template && hasTemplates(options.templates)) {
    return {
      ...base,
      status: "selected",
      strategy: "template-cv",
      reason: "local-templates-available",
      providers: enabledLocalFallbackProviders({ ocr: false, capabilities, startAt: "template" }),
      request: {
        imagePath: options.imagePath,
        templates: options.templates,
        surface: options.surface ?? "unknown",
      },
      cache: {
        policy: "template-local",
        key: buildVisualCacheKey("template", options),
        ttlMs: options.cacheTtlMs ?? 5000,
      },
      pixelLimitedAction: true,
    };
  }

  if (capabilities.somProposal && isSelfDrawnLikeSurface(options.surface)) {
    return {
      ...base,
      status: "selected",
      strategy: "som-proposal",
      reason: "self-drawn-surface-local-proposals",
      providers: ["som-proposal"],
      request: {
        imagePath: options.imagePath,
        surface: options.surface ?? "unknown",
      },
      cache: {
        policy: "som-proposal-local",
        key: buildVisualCacheKey("som-proposal", options),
        ttlMs: options.cacheTtlMs ?? 5000,
      },
      pixelLimitedAction: true,
    };
  }

  if (capabilities.vlm && options.allowVlm === true) {
    return {
      ...base,
      status: "selected",
      strategy: "optional-vlm",
      reason: "explicit-vlm-fallback-enabled",
      providers: ["vlm"],
      request: {
        imagePath: options.imagePath,
        image: normalizeImageOptional(options.image),
        surface: options.surface ?? "unknown",
      },
      cache: {
        policy: "vlm-explicit-fallback",
        key: buildVisualCacheKey("vlm", options),
        ttlMs: 0,
      },
      uploadsImage: true,
      vlm: {
        allowed: true,
        requiresApproval: true,
      },
    };
  }

  return {
    ...base,
    status: "insufficient",
    strategy: "none",
    reason: "observation.insufficient: no local perception strategy available",
    providers: [],
    request: null,
    cache: null,
  };
}

function hasActionableSemanticElements(observation = {}) {
  return (observation.elements ?? []).some((element) => {
    const actions = element.actions ?? [];
    return actions.length > 0 && element.bounds;
  });
}

function normalizeCapabilities(capabilities = {}) {
  return {
    ocr: capabilities.ocr !== false,
    template: capabilities.template !== false,
    somProposal: capabilities.somProposal !== false,
    vlm: capabilities.vlm === true,
  };
}

function enabledLocalFallbackProviders({ ocr, capabilities, startAt = "ocr" }) {
  const providers = [];
  if (ocr && startAt === "ocr") providers.push("ocr");
  if (capabilities.template) providers.push("template");
  if (capabilities.somProposal) providers.push("som-proposal");
  return providers;
}

function hasTemplates(templates) {
  return Array.isArray(templates) && templates.length > 0;
}

function isSelfDrawnLikeSurface(surface) {
  return new Set(["canvas", "self-drawn", "qt", "industrial", "editor", "cad"]).has(surface);
}

function buildVisualCacheKey(kind, options) {
  const windowId = normalizeWindow(options.window).id;
  const image = normalizeImageOptional(options.image ?? options.dirtyRegion?.image ?? options.regionHint?.image);
  const imagePart = image ? `${image.width}x${image.height}` : "unknown-size";
  return ["perception", "v1", kind, windowId, options.surface ?? "unknown", imagePart].join(":");
}

function normalizeWindow(window = {}) {
  return {
    id: String(window.id ?? window.windowId ?? window.window_id ?? "unknown-window"),
    title: String(window.title ?? ""),
  };
}

function normalizeImageOptional(image = undefined) {
  if (!image) return null;
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}
