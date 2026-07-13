const DEFAULT_THRESHOLDS = Object.freeze({
  iou: 0.5,
  fusedConfidence: 0.98,
  providerMinimums: Object.freeze({
    "som-proposal": 0.85,
    ocr: 0.90,
    template: 0.995,
  }),
});

export function fusePerceptionProposals(options = {}) {
  const thresholds = normalizeThresholds(options.thresholds);
  const candidates = [
    ...normalizeCandidates(options.template, "template"),
    ...normalizeCandidates(options.som, "som-proposal"),
    ...normalizeCandidates(options.ocr, "ocr"),
  ];
  const ignored = (options.ignored ?? []).map((entry) => normalizeBox(entry?.box));
  const clusters = clusterCandidates(candidates, thresholds.iou);
  const proposals = [];
  const observationProposals = [];
  let ignoredClusters = 0;

  for (const cluster of clusters) {
    const support = bestPerProvider(cluster);
    const bounds = preferredBounds(support);
    if (ignored.some((box) => intersectionOverUnion(bounds, box) >= thresholds.iou)) {
      ignoredClusters += 1;
      continue;
    }
    const eligibleSupport = support.filter((entry) => entry.confidence >= thresholds.providerMinimums[entry.provider]);
    const exactTemplate = eligibleSupport.find((entry) => entry.provider === "template"
      && entry.exact === true && entry.approvedActionLabel === true && entry.confidence >= thresholds.providerMinimums.template);
    const independent = new Set(eligibleSupport.map((entry) => entry.provider)).size >= 2;
    const fusedConfidence = complementProduct(eligibleSupport.map((entry) => entry.confidence));
    const actionEligible = Boolean(exactTemplate) || (independent && fusedConfidence >= thresholds.fusedConfidence);
    const source = exactTemplate ? "template" : (actionEligible ? "local-proposal-fusion" : "local-proposal-observation");
    const modelIdentity = exactTemplate
      ? { provider: "template", model: "exact-template-v1" }
      : { provider: "local-proposal-fusion", model: "som-ocr-v1" };
    const proposal = Object.freeze({
      proposalId: stableProposalId(bounds, support),
      box: Object.freeze(bounds),
      bounds: Object.freeze({ ...bounds }),
      sourceRegion: Object.freeze({ ...bounds }),
      modelIdentity: Object.freeze(modelIdentity),
      role: preferredValue(support, "role") ?? "region",
      label: preferredLabel(support),
      confidence: actionEligible ? fusedConfidence : Math.max(0, ...support.map((entry) => entry.confidence)),
      support: Object.freeze(support.map((entry) => Object.freeze({
        provider: entry.provider,
        confidence: entry.confidence,
        proposalId: entry.proposalId,
      }))),
      actionEligible,
      pixelLimitedAction: true,
      guessedAction: false,
      actions: Object.freeze(["click"]),
      source,
      exact: Boolean(exactTemplate),
      approvedActionLabel: Boolean(exactTemplate),
    });
    if (actionEligible) proposals.push(proposal);
    else observationProposals.push(proposal);
  }

  return Object.freeze({
    status: proposals.length > 0 ? "fused" : "insufficient",
    proposals: Object.freeze(sortByPosition(proposals)),
    observationProposals: Object.freeze(sortByPosition(observationProposals)),
    ignoredClusters,
    includeUserOverlay: false,
    startsDesktopControl: false,
  });
}

function normalizeThresholds(value = {}) {
  return {
    iou: finiteRatio(value.iou ?? DEFAULT_THRESHOLDS.iou, "perception.fusion_iou_invalid"),
    fusedConfidence: finiteRatio(value.fusedConfidence ?? DEFAULT_THRESHOLDS.fusedConfidence, "perception.fusion_confidence_invalid"),
    providerMinimums: {
      ...DEFAULT_THRESHOLDS.providerMinimums,
      ...(value.providerMinimums ?? {}),
    },
  };
}

function normalizeCandidates(values = [], provider) {
  if (!Array.isArray(values)) throw fusionError("perception.fusion_candidates_invalid");
  return values.map((entry, index) => {
    const confidence = Number(entry?.confidence ?? entry?.score);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw fusionError("perception.fusion_confidence_invalid");
    return {
      ...entry,
      provider,
      proposalId: String(entry.proposalId ?? entry.templateId ?? `${provider}-${index + 1}`),
      box: normalizeBox(entry.box ?? entry.bounds),
      confidence,
    };
  });
}

function clusterCandidates(candidates, threshold) {
  const clusters = [];
  for (const candidate of candidates.sort(compareCandidate)) {
    const cluster = clusters.find((entries) => entries.some((entry) => intersectionOverUnion(entry.box, candidate.box) >= threshold));
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }
  return clusters;
}

function bestPerProvider(cluster) {
  const best = new Map();
  for (const candidate of cluster) {
    const current = best.get(candidate.provider);
    if (!current || candidate.confidence > current.confidence) best.set(candidate.provider, candidate);
  }
  return [...best.values()].sort((left, right) => left.provider.localeCompare(right.provider, "en"));
}

function preferredBounds(support) {
  for (const provider of ["template", "som-proposal", "ocr"]) {
    const candidate = support.find((entry) => entry.provider === provider);
    if (candidate) return { ...candidate.box };
  }
  return { ...support[0].box };
}

function preferredLabel(support) {
  for (const provider of ["ocr", "template", "som-proposal"]) {
    const value = support.find((entry) => entry.provider === provider)?.label;
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "Unlabeled local proposal";
}

function preferredValue(support, key) {
  for (const provider of ["template", "som-proposal", "ocr"]) {
    const value = support.find((entry) => entry.provider === provider)?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

function complementProduct(scores) {
  if (scores.length === 0) return 0;
  const value = 1 - scores.reduce((product, score) => product * (1 - score), 1);
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000_000) / 1_000_000;
}

function stableProposalId(bounds, support) {
  return `fused-${bounds.x}-${bounds.y}-${support.map((entry) => entry.provider).join("+")}`;
}

function sortByPosition(values) {
  return values.sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
}

function compareCandidate(left, right) {
  return left.box.y - right.box.y || left.box.x - right.box.x || right.confidence - left.confidence;
}

function normalizeBox(box) {
  if (box === null || typeof box !== "object" || Array.isArray(box)
    || !Number.isFinite(box.x) || box.x < 0
    || !Number.isFinite(box.y) || box.y < 0
    || !Number.isFinite(box.width) || box.width <= 0
    || !Number.isFinite(box.height) || box.height <= 0) {
    throw fusionError("perception.fusion_box_invalid");
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function intersectionOverUnion(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union === 0 ? 0 : intersection / union;
}

function finiteRatio(value, code) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) throw fusionError(code);
  return value;
}

function fusionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
