# PR7B Perception Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded perception samples with a versioned 400-region OCR and 200-scene complex-visual corpus executed by the released local providers.

**Architecture:** Define a strict corpus manifest, deterministic quick-fixture generator, privacy scanner, and provider-backed benchmark runner. Full corpus bytes remain in a separate hash-locked pack; source-controlled files contain the lock, public/generated annotations, licenses, and quick generators only.

**Tech Stack:** Node.js 20+ ESM, `ppu-ocv` canvas/image APIs, PP-OCRv6 ONNX sidecar, existing template/SOM providers, Node test runner.

## Global Constraints

- PR6A is merged first; benchmark samples and reports are written through its evidence core.
- Full corpus minimums: 400 OCR regions and 200 complex-visual scenes.
- OCR composition is exactly at least 150 Chinese, 150 English, 50 numeric, and 50 mixed samples.
- Coverage includes eight application classes, three DPI levels, and light/dark themes.
- Repository and evidence contain no complete private window capture or user document.
- Phase 3.5 may consume only measured provider results; caller-supplied latency arrays are forbidden.

---

### Task 1: Freeze the corpus manifest and lock

**Files:**
- Create: `src/perception-corpus.mjs`
- Create: `docs/productization/perception-corpus.lock.json`
- Create: `test/perception-corpus.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `parsePerceptionCorpusManifest(value) -> CorpusManifest`.
- Produces: `verifyPerceptionCorpus({ root, lock, tier }) -> Promise<VerifiedCorpus>`.

- [ ] **Step 1: Write failing schema and inventory tests**

Test category counts, application classes, DPI/themes, unique sample IDs, relative paths, exact sizes/SHA-256, license IDs, annotation shape, Windows case-fold collisions, traversal, symlink/reparse points, and unreferenced files.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-corpus.test.mjs`

Expected: FAIL because corpus verification does not exist.

- [ ] **Step 3: Implement manifest schema version 1**

OCR annotations contain normalized text, language class, critical-label flag, region, DPI, theme, and application class. Visual annotations contain target boxes, ignored boxes, role, label, actionable flag, and surface class. Resolve the complete pack from `AGENT_COMPUTER_USE_PERCEPTION_CORPUS` or `artifacts/perception-corpus/current`; never download at runtime. Ignore `/artifacts/perception-corpus/`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/perception-corpus.test.mjs
git add .gitignore src/perception-corpus.mjs docs/productization/perception-corpus.lock.json test/perception-corpus.test.mjs
git commit -m "feat: freeze the perception corpus contract"
```

### Task 2: Generate the deterministic PR quick corpus

**Files:**
- Create: `src/perception-fixture-generator.mjs`
- Create: `scripts/generate-quick-perception-corpus.mjs`
- Create: `test/perception-fixture-generator.test.mjs`
- Create: `test/fixtures/perception/quick/manifest.json`

**Interfaces:**
- Produces: `generateQuickCorpus({ outputRoot, seed }) -> Promise<CorpusManifest>`.

- [ ] **Step 1: Write failing determinism tests**

Assert two generations with seed `20260713` have identical relative paths, PNG bytes, annotations, and hashes; a different seed changes sample pixels but not schema coverage. Assert generated text covers Chinese, English, numbers, mixed labels, light/dark, 100/125/150 DPI, Canvas, timeline, CAD-like, toolbar, dialog, table, and editor surfaces.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-fixture-generator.test.mjs`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement bitmap generation**

Use `createCanvas` and deterministic seeded layout. Generate compact fixtures at test time; source control keeps only the quick manifest/generator contract, not hundreds of duplicated images. Every scene contains known boxes and explicit ignored decoration.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/perception-fixture-generator.test.mjs
git add src/perception-fixture-generator.mjs scripts/generate-quick-perception-corpus.mjs test/perception-fixture-generator.test.mjs test/fixtures/perception/quick/manifest.json
git commit -m "test: generate deterministic perception fixtures"
```

### Task 3: Add deterministic privacy scanning

**Files:**
- Create: `src/perception-privacy-scanner.mjs`
- Create: `test/perception-privacy-scanner.test.mjs`

**Interfaces:**
- Produces: `scanCorpusPrivacy({ manifest, root }) -> Promise<PrivacyReport>`.

- [ ] **Step 1: Write failing privacy tests**

Reject absolute home paths, email/phone/contact fixtures not explicitly public, password/payment/credential labels, recent-file metadata, GPS/IP/host values, EXIF/text chunks, full-desktop dimensions, unlicensed sources, and samples outside declared regions. Accept generated/public labels and sanitized crops.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-privacy-scanner.test.mjs`

Expected: FAIL because no scanner exists.

- [ ] **Step 3: Implement metadata and pixel-boundary checks**

Parse PNG chunks with a bounded structured parser, reject unexpected ancillary text/profile metadata, scan manifest strings recursively, and compare dimensions to declared crop/scene bounds. Do not add a face detector or network service.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/perception-privacy-scanner.test.mjs
git add src/perception-privacy-scanner.mjs test/perception-privacy-scanner.test.mjs
git commit -m "feat: reject private perception corpus content"
```

### Task 4: Implement OCR and proposal metrics

**Files:**
- Create: `src/perception-benchmark-metrics.mjs`
- Create: `test/perception-benchmark-metrics.test.mjs`

**Interfaces:**
- Produces: `normalizeUiText(text, languageClass) -> string`.
- Produces: `calculateOcrMetrics(samples) -> OcrMetrics`.
- Produces: `calculateProposalMetrics(samples, { iouThreshold }) -> ProposalMetrics`.

- [ ] **Step 1: Write failing metric tests**

Cover NFKC normalization, CR/LF and whitespace normalization, full-width numbers, punctuation preservation for labels, Unicode code-point edit distance, critical-label recall, nearest-rank P95, IoU matching, duplicate proposal false positives, ignored boxes, precision, recall, and zero guessed actions.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-benchmark-metrics.test.mjs`

Expected: FAIL because benchmark metrics do not exist.

- [ ] **Step 3: Implement deterministic metrics**

Character accuracy is `1 - total edit distance / total expected code points`. Critical recall is exact normalized-label matches. Proposal matching uses one-to-one greedy descending-confidence matches at IoU >= 0.5; ignored regions neither help recall nor count as false positives.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/perception-benchmark-metrics.test.mjs
git add src/perception-benchmark-metrics.mjs test/perception-benchmark-metrics.test.mjs
git commit -m "feat: measure OCR and proposal quality"
```

### Task 5: Execute released providers against the corpus

**Files:**
- Create: `src/perception-benchmark-runner.mjs`
- Create: `test/perception-benchmark-runner.test.mjs`
- Modify: `src/offline-perception-probe.mjs`

**Interfaces:**
- Produces: `runPerceptionBenchmark({ corpus, providers, eventSink }) -> Promise<BenchmarkReport>`.

- [ ] **Step 1: Write failing provider-execution tests**

Assert each OCR sample calls the real OCR adapter interface, each visual sample calls template/SOM strategy, provider/model identity is retained, per-sample duration is measured internally, overlay is excluded, errors remain attached to sample IDs, and no input summary arrays are accepted.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-benchmark-runner.test.mjs`

Expected: FAIL because the benchmark runner does not exist.

- [ ] **Step 3: Implement bounded sequential/batched execution**

Start one warm OCR sidecar per run, perform declared warmup samples outside metrics, batch only same-size OCR regions, run visual providers with bounded concurrency, and append one evidence event per sample. A provider crash fails affected samples and the aggregate; it does not silently skip them.

- [ ] **Step 4: Run GREEN and quick real-provider smoke**

Run: `node --test test/perception-benchmark-runner.test.mjs test/offline-perception-probe.test.mjs`

Run: `node scripts/generate-quick-perception-corpus.mjs --output artifacts/perception-corpus/quick && node src/phase-3-5-perception-latency-report.mjs --corpus artifacts/perception-corpus/quick`

Expected: the command reports measured samples and may fail quality targets before PR7C; it must not report hard-coded values.

- [ ] **Step 5: Commit**

```bash
git add src/perception-benchmark-runner.mjs src/offline-perception-probe.mjs test/perception-benchmark-runner.test.mjs
git commit -m "feat: benchmark released perception providers"
```

### Task 6: Replace Phase 3.5 hard-coded samples

**Files:**
- Modify: `src/phase-3-5-perception-latency-report.mjs`
- Modify: `src/perception-latency-report.mjs`
- Modify: `test/phase-3-5-perception-latency-report.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing anti-fabrication tests**

Assert the phase requires `--corpus`, rejects `samples` input, emits corpus/model identities and counts, applies 97%/95% OCR and 98%/90% proposal targets, and exits nonzero when any target fails.

- [ ] **Step 2: Run RED**

Run: `node --test test/phase-3-5-perception-latency-report.test.mjs`

Expected: FAIL because Phase 3.5 currently passes hard-coded arrays.

- [ ] **Step 3: Wire verified corpus and benchmark runner**

Add `perception:quick` and `perception:full` scripts. Quick uses generated fixtures; full requires the locked external pack. Preserve the existing small/region/full-window latency targets while sourcing values only from sample events.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/phase-3-5-perception-latency-report.test.mjs test/perception-benchmark-runner.test.mjs
git add src/phase-3-5-perception-latency-report.mjs src/perception-latency-report.mjs test/phase-3-5-perception-latency-report.test.mjs package.json
git commit -m "refactor: derive perception gates from corpus evidence"
```

### Task 7: Add nightly full-corpus evidence

**Files:**
- Create: `.github/workflows/nightly-perception.yml`
- Create: `test/nightly-perception-workflow.test.mjs`
- Modify: `docs/productization/release-gates.md`

- [ ] **Step 1: Write failing workflow tests**

Assert a hash-locked corpus cache/path, explicit verification before execution, `perception:full`, evidence upload with `if: always()`, no image upload path, and no inclusion in npm/release workflows.

- [ ] **Step 2: Run RED**

Run: `node --test test/nightly-perception-workflow.test.mjs`

Expected: FAIL because the workflow does not exist.

- [ ] **Step 3: Implement scheduled workflow and docs**

Use the prepared self-hosted app-lab or a runner with the full corpus cache. Upload only run manifest, events, report, checksums, and explicitly sanitized failing crops approved by the privacy scanner.

- [ ] **Step 4: Final verification and commit**

Run: `node --test test/perception-corpus.test.mjs test/perception-fixture-generator.test.mjs test/perception-privacy-scanner.test.mjs test/perception-benchmark-metrics.test.mjs test/perception-benchmark-runner.test.mjs test/phase-3-5-perception-latency-report.test.mjs test/nightly-perception-workflow.test.mjs`

Run: `npm test`

Run: `git diff --check`

```bash
git add .github/workflows/nightly-perception.yml test/nightly-perception-workflow.test.mjs docs/productization/release-gates.md
git commit -m "ci: retain full perception corpus evidence"
```
