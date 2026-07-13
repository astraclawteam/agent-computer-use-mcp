const LANGUAGE_CLASSES = new Set(["chinese", "english", "numeric", "mixed"]);

export function normalizeUiText(text, languageClass) {
  if (!LANGUAGE_CLASSES.has(languageClass)) throw metricError("perception.metric_language_invalid");
  if (typeof text !== "string") throw metricError("perception.metric_text_invalid");
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function calculateOcrMetrics(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw metricError("perception.metric_samples_required");
  let totalExpectedCodePoints = 0;
  let totalEditDistance = 0;
  let criticalLabels = 0;
  let criticalLabelMatches = 0;
  let failedSamples = 0;
  const durations = [];

  for (const sample of samples) {
    validateMetricSample(sample);
    const expected = normalizeUiText(sample.expectedText, sample.languageClass);
    const actual = normalizeUiText(typeof sample.actualText === "string" ? sample.actualText : "", sample.languageClass);
    const expectedCodePoints = [...expected];
    totalExpectedCodePoints += expectedCodePoints.length;
    totalEditDistance += codePointEditDistance(expected, actual);
    if (sample.criticalLabel) {
      criticalLabels += 1;
      if (!sample.error && expected === actual) criticalLabelMatches += 1;
    }
    if (sample.error) failedSamples += 1;
    durations.push(sample.durationMs);
  }

  return Object.freeze({
    totalSamples: samples.length,
    failedSamples,
    successfulSamples: samples.length - failedSamples,
    totalExpectedCodePoints,
    totalEditDistance,
    characterAccuracy: totalExpectedCodePoints === 0
      ? 0
      : Math.max(0, 1 - totalEditDistance / totalExpectedCodePoints),
    criticalLabels,
    criticalLabelMatches,
    criticalLabelRecall: criticalLabels === 0 ? 1 : criticalLabelMatches / criticalLabels,
    p95Ms: nearestRankPercentile(durations, 0.95),
  });
}

export function calculateProposalMetrics(samples, { iouThreshold = 0.5 } = {}) {
  if (!Array.isArray(samples) || samples.length === 0) throw metricError("perception.metric_samples_required");
  if (!Number.isFinite(iouThreshold) || iouThreshold <= 0 || iouThreshold > 1) {
    throw metricError("perception.metric_iou_threshold_invalid");
  }
  let expectedTargets = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let ignoredProposals = 0;
  let guessedActionCount = 0;
  let failedSamples = 0;
  const durations = [];

  for (const sample of samples) {
    validateMetricSample(sample);
    if (!Array.isArray(sample.expected) || !Array.isArray(sample.ignored) || !Array.isArray(sample.proposals)) {
      throw metricError("perception.metric_proposals_invalid");
    }
    const expected = sample.expected.map((entry) => ({ ...entry, box: validateBox(entry?.box) }));
    const ignored = sample.ignored.map((entry) => ({ ...entry, box: validateBox(entry?.box) }));
    const proposals = sample.proposals.map((entry, index) => {
      if (!Number.isFinite(entry?.confidence) || entry.confidence < 0 || entry.confidence > 1) {
        throw metricError("perception.metric_confidence_invalid");
      }
      return { ...entry, box: validateBox(entry.box), index };
    }).sort((a, b) => b.confidence - a.confidence || a.index - b.index);
    expectedTargets += expected.length;
    if (sample.error) failedSamples += 1;
    durations.push(sample.durationMs);
    const matched = new Set();

    for (const proposal of proposals) {
      if (proposal.guessedAction === true) guessedActionCount += 1;
      if (ignored.some((entry) => intersectionOverUnion(proposal.box, entry.box) >= iouThreshold)) {
        ignoredProposals += 1;
        continue;
      }
      let bestIndex = -1;
      let bestIou = iouThreshold;
      for (let index = 0; index < expected.length; index += 1) {
        if (matched.has(index)) continue;
        const iou = intersectionOverUnion(proposal.box, expected[index].box);
        if (iou >= bestIou) {
          bestIou = iou;
          bestIndex = index;
        }
      }
      if (bestIndex >= 0) {
        matched.add(bestIndex);
        truePositives += 1;
      } else {
        falsePositives += 1;
      }
    }
  }

  const falseNegatives = expectedTargets - truePositives;
  return Object.freeze({
    totalSamples: samples.length,
    failedSamples,
    expectedTargets,
    truePositives,
    falsePositives,
    falseNegatives,
    ignoredProposals,
    guessedActionCount,
    precision: truePositives + falsePositives === 0 ? 0 : truePositives / (truePositives + falsePositives),
    recall: expectedTargets === 0 ? 1 : truePositives / expectedTargets,
    p95Ms: nearestRankPercentile(durations, 0.95),
  });
}

function codePointEditDistance(expected, actual) {
  const left = [...expected];
  const right = [...actual];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + substitution,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function nearestRankPercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function intersectionOverUnion(left, right) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union === 0 ? 0 : intersection / union;
}

function validateMetricSample(sample) {
  if (sample === null || typeof sample !== "object" || Array.isArray(sample)
    || typeof sample.sampleId !== "string" || sample.sampleId.trim() === "") {
    throw metricError("perception.metric_sample_invalid");
  }
  if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
    throw metricError("perception.metric_duration_invalid");
  }
}

function validateBox(box) {
  if (box === null || typeof box !== "object" || Array.isArray(box)
    || !Number.isFinite(box.x) || box.x < 0
    || !Number.isFinite(box.y) || box.y < 0
    || !Number.isFinite(box.width) || box.width <= 0
    || !Number.isFinite(box.height) || box.height <= 0) {
    throw metricError("perception.metric_box_invalid");
  }
  return box;
}

function metricError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
