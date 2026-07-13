# PR6B Nightly And Release-Candidate Soak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend PR6A evidence into a two-hour scheduled soak and an eight-hour release-candidate soak whose reports are importable, trendable, and bound to an immutable candidate.

**Architecture:** Centralize duration and threshold policy in a gate module, add an evidence trend comparator, and provide separate scheduled and local/hosted entry points. Long runs write the same PR6A evidence schema; a read-only importer verifies identity and duration before Commercial 1.0 aggregation can consume them.

**Tech Stack:** Node.js 20+ ESM, GitHub Actions Windows runners, official MCP SDK, Node test runner.

## Global Constraints

- PR6A is merged first; this plan consumes its evidence core, runtime metrics, Windows probe, and sealed Phase 8.0 output.
- Nightly duration is exactly 7,200,000 ms; release-candidate duration is exactly 28,800,000 ms.
- Thresholds remain 128 MiB RSS net growth, 128 handles net growth, failure rate below 0.1%, and zero cleanup leaks.
- A passing retry never deletes or overwrites a failed run.
- Long-run evidence must match the candidate Git commit, core package, platform package, driver, overlay, OCR runtime, and model pack.
- Benchmark assets and evidence are never shipped in npm packages.

---

### Task 1: Freeze soak gate identities and durations

**Files:**
- Create: `src/soak-gate-policy.mjs`
- Create: `test/soak-gate-policy.test.mjs`
- Modify: `src/phase-8-0-runtime-soak.mjs`

**Interfaces:**
- Produces: `SOAK_GATES` for `pull-request`, `nightly`, and `release-candidate`.
- Produces: `resolveSoakGate(name, durationMs) -> SoakGate`.

- [ ] **Step 1: Write failing exact-duration tests**

```js
assert.equal(resolveSoakGate("nightly", 7_200_000).durationMs, 7_200_000);
assert.equal(resolveSoakGate("release-candidate", 28_800_000).durationMs, 28_800_000);
assert.throws(() => resolveSoakGate("release-candidate", 60_000), /runtime.soak_duration_mismatch/);
```

- [ ] **Step 2: Run RED**

Run: `node --test test/soak-gate-policy.test.mjs`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement immutable gate policy and wire Phase 8.0**

Gate objects include `id`, `durationMs`, `sampleIntervalMs: 10000`, client count, concurrency, fault cadence, thresholds, and minimum checkpoint count. Phase 8.0 accepts no environment override that weakens a named gate.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/soak-gate-policy.test.mjs test/phase-8-0-commercial-soak.test.mjs`

```bash
git add src/soak-gate-policy.mjs src/phase-8-0-runtime-soak.mjs test/soak-gate-policy.test.mjs
git commit -m "feat: freeze commercial soak gate policy"
```

### Task 2: Add trend evidence without weakening absolute gates

**Files:**
- Create: `src/runtime-evidence-trend.mjs`
- Create: `test/runtime-evidence-trend.test.mjs`

**Interfaces:**
- Produces: `compareRuntimeEvidence(current, history) -> RuntimeTrendReport`.

- [ ] **Step 1: Write failing trend tests**

Test median comparisons for P95 latency, RSS peak, RSS slope, handle peak, reconnect rate, and failure rate. Assert that a regression warning never changes an absolute target violation into pass and that mismatched package/model identities are excluded from history.

- [ ] **Step 2: Run RED**

Run: `node --test test/runtime-evidence-trend.test.mjs`

Expected: FAIL because the trend module does not exist.

- [ ] **Step 3: Implement deterministic comparison**

Use the most recent 14 verified runs with matching gate/platform/model identity. Report percentage changes and warnings at 20% regression, but keep `status` derived only from current absolute targets and evidence validity.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/runtime-evidence-trend.test.mjs
git add src/runtime-evidence-trend.mjs test/runtime-evidence-trend.test.mjs
git commit -m "feat: compare commercial soak trends"
```

### Task 3: Build the release-candidate evidence importer

**Files:**
- Create: `src/commercial-evidence-import.mjs`
- Create: `scripts/verify-release-candidate-evidence.mjs`
- Create: `test/commercial-evidence-import.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `importVerifiedEvidence({ source, store, expected }) -> Promise<ImportedEvidence>`.
- Adds `npm run soak:rc` and `npm run soak:rc:verify`.

- [ ] **Step 1: Write failing import tests**

Assert rejection for a 7:59:59 run, dirty worktree, mismatched commit/package/model identity, modified checksums, missing cleanup probe, and destination collision. Assert that a second run receives a new run directory rather than replacing the first.

- [ ] **Step 2: Run RED**

Run: `node --test test/commercial-evidence-import.test.mjs`

Expected: FAIL because import and RC scripts do not exist.

- [ ] **Step 3: Implement read-only import**

Verify the source in place, copy to a staging directory under `evidence/imported/<commit>/<run-id>`, recompute every hash, and atomically rename. `soak:rc` invokes the exact release-candidate gate; `soak:rc:verify -- <path>` verifies and imports only.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/commercial-evidence-import.test.mjs
git add src/commercial-evidence-import.mjs scripts/verify-release-candidate-evidence.mjs test/commercial-evidence-import.test.mjs package.json
git commit -m "feat: import release candidate soak evidence"
```

### Task 4: Productize the two-hour nightly workflow

**Files:**
- Modify: `.github/workflows/nightly-soak.yml`
- Create: `test/nightly-soak-workflow.test.mjs`

- [ ] **Step 1: Write a failing workflow contract test**

Parse YAML and assert `--gate nightly`, exact duration, evidence root, `timeout-minutes` above 120, `always()` artifact upload, JSON/JSONL/checksum-only paths, 30-day retention, and no screenshot extension.

- [ ] **Step 2: Run RED**

Run: `node --test test/nightly-soak-workflow.test.mjs`

Expected: FAIL because the current workflow prints a report and uploads no evidence.

- [ ] **Step 3: Update the workflow**

Run `npm run phase:8.0 -- --gate nightly --duration-ms 7200000 --evidence-root evidence/nightly` and upload the complete sealed directory with `if: always()`. Add a final verification step that fails when sealing or checksums are incomplete.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/nightly-soak-workflow.test.mjs
git add .github/workflows/nightly-soak.yml test/nightly-soak-workflow.test.mjs
git commit -m "ci: retain two hour nightly soak evidence"
```

### Task 5: Add RC operator documentation and final verification

**Files:**
- Create: `docs/productization/runtime-soak-operations.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/README.md`
- Create: `test/runtime-soak-operations.test.mjs`

- [ ] **Step 1: Write failing documentation tests**

Assert exact commands, durations, thresholds, required free disk check, sleep/Windows Update avoidance, retry retention, evidence import, and explicit prohibition on editing report JSON.

- [ ] **Step 2: Run RED, write operations guide, and run GREEN**

Run: `node --test test/runtime-soak-operations.test.mjs`

Expected before docs: FAIL. Expected after docs: PASS.

- [ ] **Step 3: Run complete PR6 verification**

Run: `node --test test/commercial-evidence.test.mjs test/commercial-runtime-metrics.test.mjs test/windows-runtime-probe.test.mjs test/runtime-soak-runner.test.mjs test/soak-gate-policy.test.mjs test/runtime-evidence-trend.test.mjs test/commercial-evidence-import.test.mjs test/nightly-soak-workflow.test.mjs test/runtime-soak-operations.test.mjs`

Run: `npm test`

Run: `git diff --check`

Expected: all tests PASS. Long-duration runs are invoked separately by their named commands.

- [ ] **Step 4: Commit**

```bash
git add docs/productization/runtime-soak-operations.md docs/productization/release-gates.md docs/productization/README.md test/runtime-soak-operations.test.mjs
git commit -m "docs: operate nightly and release candidate soak gates"
```
