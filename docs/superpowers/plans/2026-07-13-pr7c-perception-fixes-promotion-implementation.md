# PR7C Perception Fixes And Commercial Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the measured OCR and complex-visual failures without adding a large model, then aggregate verified PR6/PR7 evidence into a fail-closed Commercial Computer Use 1.0 eligibility decision.

**Architecture:** Improve text normalization and region reuse, calibrate template/SOM/OCR proposal fusion, and add a provenance-aware action gate. Finish with a read-only promotion aggregator that consumes sealed evidence from matching identities and never runs tests or infers missing results.

**Tech Stack:** Node.js 20+ ESM, PP-OCRv6 ONNX sidecar, existing `ppu-ocv` template/SOM providers, Node test runner.

## Global Constraints

- PR6A, PR6B, PR7A, and PR7B are merged first; this plan consumes their sealed evidence contracts.
- OCR character accuracy is at least 97% and critical-label recall at least 95%.
- Proposal precision is at least 98% and recall at least 90% at IoU >= 0.5.
- Warm small-crop P95 is at most 200 ms; ordinary-region P95 is at most 300 ms.
- Low-confidence or guessed-coordinate actions are always `observation.insufficient`.
- No new heavyweight detection/VLM model is introduced in this PR.
- Eligibility evidence must match one commit and all package/driver/overlay/OCR/model identities.

---

### Task 1: Preserve corpus failures as regression fixtures

**Files:**
- Create: `scripts/extract-perception-regressions.mjs`
- Create: `test/perception-regression-fixtures.test.mjs`
- Create: `test/fixtures/perception/regressions/manifest.json`

**Interfaces:**
- Produces: `extractRegressions({ report, corpus, outputRoot }) -> Promise<RegressionManifest>`.

- [ ] **Step 1: Write failing extraction tests**

Assert only failed sample IDs are copied, source hashes/annotations remain exact, privacy scan is mandatory, duplicates are rejected, and output order is stable by sample ID.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-regression-fixtures.test.mjs`

Expected: FAIL because the extractor does not exist.

- [ ] **Step 3: Implement extraction and capture the PR7B baseline**

Run the quick and available full corpus before runtime changes. Extract every OCR accuracy/label failure, proposal false positive/negative, and latency outlier that passes privacy policy. The committed regression manifest references generated/public fixtures only; real installed-app crops remain in evidence storage.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/perception-regression-fixtures.test.mjs
git add scripts/extract-perception-regressions.mjs test/perception-regression-fixtures.test.mjs test/fixtures/perception/regressions/manifest.json
git commit -m "test: preserve perception benchmark regressions"
```

### Task 2: Normalize OCR text without hiding recognition errors

**Files:**
- Create: `src/ui-text-normalization.mjs`
- Create: `test/ui-text-normalization.test.mjs`
- Modify: `src/ocr-sidecar.mjs`

**Interfaces:**
- Produces: `normalizeRecognizedUiText(text, { languageClass }) -> string`.

- [ ] **Step 1: Write failing normalization tests**

Cover Unicode NFKC, full-width ASCII/numbers, CR/LF, repeated horizontal whitespace, zero-width characters, Chinese/English surrounding spaces, and preservation of meaningful punctuation. Assert no fuzzy spelling correction or label substitution occurs.

- [ ] **Step 2: Run RED**

Run: `node --test test/ui-text-normalization.test.mjs`

Expected: FAIL because runtime OCR does not use the benchmark normalization contract.

- [ ] **Step 3: Implement one shared normalizer**

Use the same function in runtime OCR output and benchmark expected/output comparison. Retain raw text in local in-memory diagnostics only; sealed evidence stores normalized text plus raw-text SHA-256, not private raw strings.

- [ ] **Step 4: Run GREEN and regression corpus**

Run: `node --test test/ui-text-normalization.test.mjs test/ocr-sidecar.test.mjs test/perception-benchmark-metrics.test.mjs`

Run: `npm run perception:quick`

Expected: normalization regressions pass; remaining model errors stay visible.

- [ ] **Step 5: Commit**

```bash
git add src/ui-text-normalization.mjs src/ocr-sidecar.mjs test/ui-text-normalization.test.mjs
git commit -m "fix: normalize local UI OCR consistently"
```

### Task 3: Make region caching content-addressed and bounded

**Files:**
- Create: `src/perception-region-cache.mjs`
- Create: `test/perception-region-cache.test.mjs`
- Modify: `src/ocr-region-scheduler.mjs`
- Modify: `src/computer-use-provider-router.mjs`

**Interfaces:**
- Produces: `PerceptionRegionCache({ maxEntries, maxBytes, ttlMs })` with `get(key)`, `set(key, value)`, and `invalidateWindow(windowId)`.
- Produces: cache keys from window ID, region, pixel SHA-256, model identity, and normalization version.

- [ ] **Step 1: Write failing cache tests**

Assert same pixels reuse OCR, changed pixels miss, dirty-region invalidation is window-scoped, overlay pixels never enter the key/input, LRU and byte bounds hold, and cached results preserve provider/model provenance.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-region-cache.test.mjs`

Expected: FAIL because the existing scheduler describes cache policy but has no product cache.

- [ ] **Step 3: Implement bounded cache and router integration**

Hash only the cropped observation bytes after overlay exclusion. Default to 256 entries, 64 MiB, and five-second action-loop TTL. Never cache password/payment/private regions or provider errors.

- [ ] **Step 4: Run GREEN and latency benchmark**

Run: `node --test test/perception-region-cache.test.mjs test/phase-3-1-ocr-region-scheduler.test.mjs`

Run: `npm run perception:quick`

Expected: warm crop/region latency is measured from real cache hits and remains under approved P95 targets.

- [ ] **Step 5: Commit**

```bash
git add src/perception-region-cache.mjs src/ocr-region-scheduler.mjs src/computer-use-provider-router.mjs test/perception-region-cache.test.mjs
git commit -m "feat: cache local perception regions by pixels"
```

### Task 4: Calibrate local proposal fusion

**Files:**
- Create: `src/perception-proposal-fusion.mjs`
- Create: `test/perception-proposal-fusion.test.mjs`
- Modify: `src/som-proposal-provider.mjs`
- Modify: `src/template-matching-provider.mjs`
- Modify: `src/perception-strategy-selector.mjs`

**Interfaces:**
- Produces: `fusePerceptionProposals({ template, som, ocr, thresholds }) -> FusedProposalResult`.

- [ ] **Step 1: Write failing precision/recall tests**

Use the regression manifest to test one-to-one IoU clustering, duplicate suppression, OCR label attachment, independent-provider support, exact-template high-confidence support, ignored decorative regions, and low-confidence refusal.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-proposal-fusion.test.mjs`

Expected: FAIL because current template and SOM results are returned independently and SOM confidence is an uncalibrated fill-ratio heuristic.

- [ ] **Step 3: Implement explicit fusion rules**

Cluster boxes at IoU >= 0.5. A proposal is action-eligible only when either: (a) at least two independent local providers support the cluster and fused confidence is at least 0.98; or (b) an exact template match is at least 0.995 and has an approved action label. SOM-only and OCR-only boxes remain observation proposals. Confidence is the bounded complement product `1 - product(1 - calibratedScore)` with one contribution per provider.

- [ ] **Step 4: Run GREEN and corpus metrics**

Run: `node --test test/perception-proposal-fusion.test.mjs test/phase-3-2-template-matching-provider.test.mjs test/phase-3-3-som-proposal-provider.test.mjs test/phase-3-4-perception-strategy-selector.test.mjs`

Run: `npm run perception:quick`

Expected: quick proposal precision >= 98%, recall >= 90%, guessed actions zero.

- [ ] **Step 5: Commit**

```bash
git add src/perception-proposal-fusion.mjs src/som-proposal-provider.mjs src/template-matching-provider.mjs src/perception-strategy-selector.mjs test/perception-proposal-fusion.test.mjs
git commit -m "fix: calibrate local visual proposal fusion"
```

### Task 5: Enforce provenance-aware pixel action admission

**Files:**
- Create: `src/perception-action-admission.mjs`
- Create: `test/perception-action-admission.test.mjs`
- Modify: `src/computer-use-provider-router.mjs`
- Modify: `src/computer-use-mcp-tools.mjs`

**Interfaces:**
- Produces: `admitPerceptionAction({ observation, element, action }) -> AdmissionDecision`.

- [ ] **Step 1: Write failing admission tests**

Reject missing source region/model/proposal IDs, expired observations, window mismatch, low confidence, guessed coordinates, single-source SOM/OCR click, password/payment/private regions, and overlay-contaminated observations. Accept semantic UIA elements and eligible fused/template proposals under active lease.

- [ ] **Step 2: Run RED**

Run: `node --test test/perception-action-admission.test.mjs`

Expected: FAIL because pixel-limited action provenance is not centrally enforced.

- [ ] **Step 3: Implement fail-closed admission**

Return stable `observation.insufficient` or policy codes without falling back to raw coordinates. Add source region, model identity, proposal support, and expiration fields to normalized perception elements and strict MCP output schemas.

- [ ] **Step 4: Run GREEN and safety suites**

Run: `node --test test/perception-action-admission.test.mjs test/computer-use-mcp.test.mjs test/phase-5-3-tool-output-schemas.test.mjs test/phase-1-11-policy-deny-proof.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add src/perception-action-admission.mjs src/computer-use-provider-router.mjs src/computer-use-mcp-tools.mjs test/perception-action-admission.test.mjs
git commit -m "feat: fail closed on unsafe pixel actions"
```

### Task 6: Build the Commercial 1.0 promotion aggregator

**Files:**
- Create: `src/commercial-promotion.mjs`
- Create: `src/phase-9-0-commercial-promotion.mjs`
- Create: `test/commercial-promotion.test.mjs`
- Modify: `src/computer-use-provider-router.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `evaluateCommercialPromotion({ evidenceDirectories, expected }) -> Promise<PromotionReport>`.
- Adds `npm run phase:9.0` and health phase `9.0: commercial-promotion-evidence`.

- [ ] **Step 1: Write failing eligibility tests**

Assert false eligibility for missing/short/mismatched 15-minute, 2-hour, or 8-hour soak; any Tier A non-pass; missing Browser/Electron/Office/Complex Canvas installed pass; missing CAD-like/timeline metrics; OCR/proposal target failure; privacy/cleanup violation; failed evidence hidden by a newer pass; or mismatched package/model identity.

- [ ] **Step 2: Run RED**

Run: `node --test test/commercial-promotion.test.mjs`

Expected: FAIL because no read-only promotion aggregator exists.

- [ ] **Step 3: Implement verified-evidence aggregation**

Call `verifyEvidenceDirectory` for every input before reading reports. Group by candidate identity, retain all failed run IDs, and produce `eligible: true` only when one identity group satisfies every Section 10 requirement in the approved design. The phase accepts evidence paths only; it cannot execute tests or download assets.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/commercial-promotion.test.mjs
git add src/commercial-promotion.mjs src/phase-9-0-commercial-promotion.mjs test/commercial-promotion.test.mjs src/computer-use-provider-router.mjs package.json
git commit -m "feat: aggregate Commercial 1.0 evidence"
```

### Task 7: Make Commercial 1.0 an explicit release gate

**Files:**
- Modify: `src/release-readiness-gate.mjs`
- Modify: `src/release-metadata.mjs`
- Modify: `test/phase-0-11-release-readiness.test.mjs`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: Write failing release-contract tests**

Assert preview releases remain publishable without claiming 1.0, but any stable `1.x` metadata requires verified Phase 9.0 evidence. Assert docs distinguish public preview from commercial eligibility and list all exact thresholds.

- [ ] **Step 2: Run RED**

Run: `node --test test/phase-0-11-release-readiness.test.mjs test/commercial-promotion.test.mjs`

Expected: FAIL because release readiness has no Commercial 1.0 channel gate.

- [ ] **Step 3: Implement channel-aware readiness**

For versions below 1.0, report `commercialEligible: false` without changing existing preview release behavior. For stable 1.x, require a verified Phase 9.0 report matching the candidate tag and release identities.

- [ ] **Step 4: Run full verification**

Run: `node --test test/perception-regression-fixtures.test.mjs test/ui-text-normalization.test.mjs test/perception-region-cache.test.mjs test/perception-proposal-fusion.test.mjs test/perception-action-admission.test.mjs test/commercial-promotion.test.mjs test/phase-0-11-release-readiness.test.mjs`

Run: `npm run perception:quick`

Run: `npm test`

Run: `git diff --check`

Expected: all automated tests pass; quick corpus meets approved metrics; stable promotion remains false until complete environment evidence is supplied.

- [ ] **Step 5: Commit**

```bash
git add src/release-readiness-gate.mjs src/release-metadata.mjs test/phase-0-11-release-readiness.test.mjs README.md docs/productization/release-gates.md docs/productization/roadmap.md
git commit -m "feat: gate stable releases on commercial evidence"
```
