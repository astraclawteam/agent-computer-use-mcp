import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { verifyEvidenceDirectory } from "../src/commercial-evidence.mjs";
import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";
import {
  PERCEPTION_LATENCY_TARGETS,
  PERCEPTION_QUALITY_TARGETS,
  buildPerceptionLatencyReport,
} from "../src/perception-latency-report.mjs";
import { runPhase35 } from "../src/phase-3-5-perception-latency-report.mjs";

test("Phase 3.5 derives quality and latency gates only from a measured benchmark", () => {
  const report = buildPerceptionLatencyReport({ benchmark: passingBenchmark() });

  assert.equal(report.status, "passed");
  assert.equal(report.phase, "3.5");
  assert.equal(report.benchmark, "perception-corpus-gate");
  assert.deepEqual(report.corpus, { packId: "quick", version: "1", tier: "quick", samples: 8 });
  assert.equal(report.identities.ocr.modelPack, "pp-ocrv6-small");
  assert.equal(report.targets.ocrCharacterAccuracy, 0.97);
  assert.equal(report.targets.criticalLabelRecall, 0.95);
  assert.equal(report.targets.proposalPrecision, 0.98);
  assert.equal(report.targets.proposalRecall, 0.9);
  assert.equal(report.targets.smallUiCropWarmP95Ms, 200);
  assert.equal(report.targets.ordinaryWindowRegionWarmP95Ms, 300);
  assert.equal(report.targets.fullWindowFirstRunMs, 1000);
  assert.equal(report.cases.smallUiCrop.warmP95Ms, 180);
  assert.equal(report.cases.ordinaryWindowRegion.warmP95Ms, 280);
  assert.equal(report.cases.fullWindowFirstRun.firstRunMs, 900);
  assert.equal(report.cases.fullWindowWarmDiagnostic.warmP95Ms, 620);
  assert.equal(report.fullWindow.cacheVerified, true);
  assert.deepEqual(report.regressions, []);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

test("Phase 3.5 fails every quality, latency, provider, and full-window breach", () => {
  const benchmark = passingBenchmark();
  benchmark.status = "failed";
  benchmark.ocr.characterAccuracy = 0.96;
  benchmark.ocr.criticalLabelRecall = 0.94;
  benchmark.proposal.precision = 0.97;
  benchmark.proposal.recall = 0.89;
  benchmark.proposal.guessedActionCount = 1;
  benchmark.samples.find((sample) => sample.latencyClass === "small-ui-crop").durationMs = 201;
  benchmark.samples.find((sample) => sample.latencyClass === "ordinary-window-region").durationMs = 301;
  benchmark.samples.find((sample) => sample.latencyClass === "full-window-diagnostic").durationMs = 1001;
  benchmark.fullWindow.cacheVerified = false;
  benchmark.fullWindow.progressAware = false;
  benchmark.fullWindow.actionLoopAllowed = true;
  benchmark.regressions = [{ sampleId: "visual-1", failures: [{ code: "proposal.false-positive" }] }];
  const report = buildPerceptionLatencyReport({ benchmark });

  assert.equal(report.status, "failed");
  assert.deepEqual(report.regressions, benchmark.regressions);
  assert.deepEqual(report.violations.map((violation) => violation.code), [
    "benchmark-provider-failure",
    "ocr-character-accuracy-below-target",
    "ocr-critical-label-recall-below-target",
    "proposal-precision-below-target",
    "proposal-recall-below-target",
    "proposal-guessed-action-detected",
    "small-ui-crop-warm-p95-exceeded",
    "ordinary-window-region-warm-p95-exceeded",
    "full-window-first-run-exceeded",
    "full-window-ocr-in-action-loop",
    "full-window-progress-missing",
    "full-window-cache-missing",
  ]);
});

test("Phase 3.5 rejects caller-supplied arrays and incomplete measured evidence", () => {
  assert.throws(
    () => buildPerceptionLatencyReport({ samples: { smallUiCrop: [1] } }),
    /perception\.latency_samples_forbidden/u,
  );
  assert.throws(() => buildPerceptionLatencyReport({}), /perception\.benchmark_required/u);
  const incomplete = passingBenchmark();
  incomplete.samples = incomplete.samples.filter((sample) => sample.latencyClass !== "ordinary-window-region");
  const report = buildPerceptionLatencyReport({ benchmark: incomplete });
  assert.equal(report.status, "failed");
  assert.equal(report.violations.some((violation) => violation.code === "ordinary-window-region-samples-missing"), true);
});

test("Phase 3.5 CLI requires a corpus and package scripts separate quick from full", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:3.5"], "node src/phase-3-5-perception-latency-report.mjs");
  assert.match(packageJson.scripts["perception:quick"], /generate-quick-perception-corpus/u);
  assert.match(packageJson.scripts["perception:quick"], /--corpus artifacts\/perception-corpus\/quick/u);
  assert.match(packageJson.scripts["perception:full"], /--tier full/u);
  assert.match(packageJson.scripts["perception:full"], /perception-corpus\.lock\.json/u);

  const source = readFileSync("src/phase-3-5-perception-latency-report.mjs", "utf8");
  assert.doesNotMatch(source, /smallUiCrop:\s*\[/u);
  assert.doesNotMatch(source, /ordinaryWindowRegion:\s*\[/u);
  const result = await runNode(["src/phase-3-5-perception-latency-report.mjs"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /perception\.corpus_argument_required/u);

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["3.5"], "perception-latency-budget");
});

test("Phase 3.5 seals provider events and a failing or passing report through evidence core", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "acu-phase35-corpus-"));
  const evidenceRoot = await mkdtemp(join(tmpdir(), "acu-phase35-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(evidenceRoot, { recursive: true, force: true }));
  await generateQuickCorpus({ outputRoot: root, seed: 20260713 });

  const report = await runPhase35({
    corpusRoot: root,
    tier: "quick",
    evidenceRoot,
    sourceCommit: "a".repeat(40),
    providers: passingProviders(),
  });
  const runs = await readdir(evidenceRoot, { withFileTypes: true });
  const run = runs.find((entry) => entry.isDirectory());
  assert.ok(run);
  const verified = await verifyEvidenceDirectory(join(evidenceRoot, run.name));
  assert.equal(verified.status, "passed");
  assert.equal(verified.eventCount, 19);
  assert.equal(verified.report.status, report.status);
  assert.deepEqual(verified.files.map((file) => file.path), ["events.jsonl", "report.json", "run-manifest.json"]);
});

function passingBenchmark() {
  return {
    status: "measured",
    corpus: { packId: "quick", version: "1", tier: "quick", samples: 8 },
    identities: {
      ocr: { provider: "xiaozhiclaw-ocr-sidecar", modelPack: "pp-ocrv6-small", modelFormat: "onnx" },
      visual: { provider: "som-proposal", model: "local-components-v1" },
    },
    ocr: { characterAccuracy: 0.98, criticalLabelRecall: 0.96, failedSamples: 0 },
    proposal: { precision: 0.99, recall: 0.91, guessedActionCount: 0, failedSamples: 0 },
    fullWindow: { actionLoopAllowed: false, progressAware: true, cacheVerified: true, cachePrimeMs: 500, cacheHitMs: 0 },
    regressions: [],
    samples: [
      measured("small-1", "small-ui-crop", 120),
      measured("small-2", "small-ui-crop", 180),
      measured("region-1", "ordinary-window-region", 240),
      measured("region-2", "ordinary-window-region", 280),
      measured("full-1", "full-window-diagnostic", 900),
      measured("full-2", "full-window-diagnostic", 620),
      { sampleId: "visual-1", kind: "visual", durationMs: 30 },
      { sampleId: "visual-2", kind: "visual", durationMs: 40 },
    ],
  };
}

function measured(sampleId, latencyClass, durationMs) {
  return { sampleId, kind: "ocr", latencyClass, durationMs };
}

function passingProviders() {
  const identity = {
    provider: "xiaozhiclaw-ocr-sidecar",
    modelPack: "pp-ocrv6-small",
    modelFormat: "onnx",
    runtime: "onnxruntime-cpu",
    executionProvider: "CPUExecutionProvider",
  };
  return {
    ocr: {
      async open() {
        return {
          identity,
          async warmup() {},
          async recognize(request) { return { text: request.sample.annotation.normalizedText, identity }; },
          async verifyCache() { return { cacheHit: true, primeMs: 80, hitMs: 0 }; },
          async close() {},
        };
      },
    },
    visual: {
      identity: { provider: "som-proposal", model: "local-components-v1" },
      async run(request) {
        return {
          proposals: request.sample.annotation.targets.map((target) => ({ box: target.box, confidence: 1, guessedAction: false })),
          identity: this.identity,
        };
      },
    },
  };
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

assert.equal(PERCEPTION_QUALITY_TARGETS.ocrCharacterAccuracy, 0.97);
assert.equal(PERCEPTION_LATENCY_TARGETS.smallUiCropWarmP95Ms, 200);
