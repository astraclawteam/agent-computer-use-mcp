import { performance } from "node:perf_hooks";

import { calculateOcrMetrics, calculateProposalMetrics } from "./perception-benchmark-metrics.mjs";

export async function runPerceptionBenchmark(options = {}) {
  const corpus = validateCorpus(options.corpus);
  const providers = validateProviders(options.providers);
  const eventSink = options.eventSink ?? (() => {});
  if (typeof eventSink !== "function") throw benchmarkError("perception.benchmark_event_sink_invalid");
  if (Object.hasOwn(options, "samples")) throw benchmarkError("perception.benchmark_samples_forbidden");
  const visualConcurrency = options.visualConcurrency ?? 2;
  if (!Number.isSafeInteger(visualConcurrency) || visualConcurrency < 1 || visualConcurrency > 8) {
    throw benchmarkError("perception.benchmark_concurrency_invalid");
  }

  const ocrSamples = corpus.samples.filter((sample) => sample.kind === "ocr");
  const visualSamples = corpus.samples.filter((sample) => sample.kind === "visual");
  const sampleResults = [];
  const ocrMetricInputs = [];
  const proposalMetricInputs = [];
  let ocrIdentity = null;
  let ocrSession = null;

  try {
    if (ocrSamples.length > 0) {
      ocrSession = await providers.ocr.open();
      ocrIdentity = normalizeIdentity(ocrSession.identity, "ocr");
      const warmup = ocrSamples.slice(0, 1).map((sample) => requestForSample(corpus, sample));
      await ocrSession.warmup(warmup);
      for (const sample of ocrSamples) {
        const result = await runOcrSample({ corpus, sample, session: ocrSession, eventSink, expectedIdentity: ocrIdentity });
        sampleResults.push(result.publicResult);
        ocrMetricInputs.push(result.metricInput);
      }
    }

    const visualResults = await mapBounded(visualSamples, visualConcurrency, async (sample) => runVisualSample({
      corpus,
      sample,
      provider: providers.visual,
      eventSink,
    }));
    for (const result of visualResults) {
      sampleResults.push(result.publicResult);
      proposalMetricInputs.push(result.metricInput);
    }
  } finally {
    if (ocrSession) await ocrSession.close();
  }

  const ocrMetrics = calculateOcrMetrics(ocrMetricInputs);
  const proposalMetrics = calculateProposalMetrics(proposalMetricInputs, { iouThreshold: 0.5 });
  sampleResults.sort((left, right) => corpus.samples.findIndex((sample) => sample.id === left.sampleId)
    - corpus.samples.findIndex((sample) => sample.id === right.sampleId));
  const failed = sampleResults.some((sample) => sample.error);
  return Object.freeze({
    status: failed ? "failed" : "measured",
    benchmark: "perception-corpus",
    corpus: Object.freeze({ packId: corpus.packId, version: corpus.version, tier: corpus.tier, samples: corpus.samples.length }),
    identities: Object.freeze({
      ocr: ocrIdentity,
      visual: normalizeIdentity(providers.visual.identity, "visual"),
    }),
    ocr: ocrMetrics,
    proposal: proposalMetrics,
    samples: Object.freeze(sampleResults),
    includeUserOverlay: false,
  });
}

async function runOcrSample({ corpus, sample, session, eventSink, expectedIdentity }) {
  const started = performance.now();
  let response;
  let error;
  try {
    response = await session.recognize(requestForSample(corpus, sample));
    assertSameIdentity(expectedIdentity, normalizeIdentity(response.identity ?? session.identity, "ocr"));
  } catch (caught) {
    error = sanitizeError(caught);
  }
  const durationMs = elapsed(started);
  const publicResult = sampleResult(sample, durationMs, response?.identity ?? session.identity, error);
  await eventSink(eventForSample(publicResult));
  return {
    publicResult,
    metricInput: {
      sampleId: sample.id,
      expectedText: sample.annotation.normalizedText,
      actualText: error ? "" : String(response?.text ?? ""),
      languageClass: sample.annotation.languageClass,
      criticalLabel: sample.annotation.criticalLabel,
      durationMs,
      error,
    },
  };
}

async function runVisualSample({ corpus, sample, provider, eventSink }) {
  const started = performance.now();
  let response;
  let error;
  try {
    response = await provider.run(requestForSample(corpus, sample));
    assertSameIdentity(normalizeIdentity(provider.identity, "visual"), normalizeIdentity(response.identity ?? provider.identity, "visual"));
  } catch (caught) {
    error = sanitizeError(caught);
  }
  const durationMs = elapsed(started);
  const publicResult = sampleResult(sample, durationMs, response?.identity ?? provider.identity, error);
  await eventSink(eventForSample(publicResult));
  return {
    publicResult,
    metricInput: {
      sampleId: sample.id,
      expected: sample.annotation.targets,
      ignored: sample.annotation.ignored,
      proposals: error ? [] : (response?.proposals ?? []),
      durationMs,
      error,
    },
  };
}

function requestForSample(corpus, sample) {
  return Object.freeze({
    sampleId: sample.id,
    sample,
    imagePath: corpus.resolveImagePath(sample.id),
    includeUserOverlay: false,
    startsDesktopControl: false,
  });
}

function sampleResult(sample, durationMs, identity, error) {
  return Object.freeze({
    sampleId: sample.id,
    kind: sample.kind,
    applicationClass: sample.applicationClass,
    dpi: sample.dpi,
    theme: sample.theme,
    durationMs,
    identity: normalizeIdentity(identity, sample.kind),
    ...(error ? { error } : {}),
    includeUserOverlay: false,
  });
}

function eventForSample(result) {
  return Object.freeze({
    type: "perception.sample.measured",
    sampleId: result.sampleId,
    kind: result.kind,
    durationMs: result.durationMs,
    identity: result.identity,
    status: result.error ? "failed" : "measured",
    ...(result.error ? { error: result.error } : {}),
    includeUserOverlay: false,
  });
}

async function mapBounded(items, concurrency, operation) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function validateCorpus(corpus) {
  if (corpus?.status !== "verified" || !Array.isArray(corpus.samples) || corpus.samples.length === 0
    || typeof corpus.resolveImagePath !== "function") {
    throw benchmarkError("perception.benchmark_corpus_unverified");
  }
  if (!corpus.samples.some((sample) => sample.kind === "ocr") || !corpus.samples.some((sample) => sample.kind === "visual")) {
    throw benchmarkError("perception.benchmark_corpus_incomplete");
  }
  return corpus;
}

function validateProviders(providers) {
  if (typeof providers?.ocr?.open !== "function" || typeof providers?.visual?.run !== "function") {
    throw benchmarkError("perception.benchmark_providers_invalid");
  }
  normalizeIdentity(providers.visual.identity, "visual");
  return providers;
}

function normalizeIdentity(identity, kind) {
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)
    || typeof identity.provider !== "string" || identity.provider.trim() === "") {
    throw benchmarkError("perception.benchmark_identity_invalid", kind);
  }
  const output = { provider: identity.provider };
  for (const key of ["model", "modelPack", "modelFormat", "runtime", "executionProvider"]) {
    if (typeof identity[key] === "string" && identity[key].trim() !== "") output[key] = identity[key];
  }
  return Object.freeze(output);
}

function assertSameIdentity(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw benchmarkError("perception.benchmark_identity_changed");
}

function sanitizeError(error) {
  const candidate = typeof error?.code === "string" ? error.code : String(error?.message ?? error).split(":", 1)[0];
  return /^[a-z][a-z0-9._-]{1,100}$/u.test(candidate) ? candidate : "provider.failed";
}

function elapsed(started) {
  return Math.round(Math.max(0, performance.now() - started) * 1000) / 1000;
}

function benchmarkError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
