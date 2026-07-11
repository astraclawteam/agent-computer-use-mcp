# PR4-PR7 Commercial Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Windows x64 release, production publishing, runtime soak, and real-application perception evidence needed for the commercial local MCP module.

**Architecture:** PR4 remains an unsigned, deterministic assembly stage. PR5 consumes only verified PR4 inputs, signs first-party PE files through Azure Artifact Signing, rebuilds trust/checksum metadata, creates a draft GitHub Release, publishes the protected npm staging package through OIDC trusted publishing, runs post-publish smoke, and only then publishes the GitHub Release. PR6 and PR7 add separate executable evidence producers whose JSON reports feed release gates without entering agent observations.

**Tech Stack:** Node.js 24 release runner, official `@modelcontextprotocol/sdk`, .NET 10 NativeAOT, GitHub Actions, Azure Artifact Signing v2, npm trusted publishing/provenance, Windows UIA/cua-driver, PP-OCRv6 ONNX.

## Global Constraints

- Formal releases are triggered only by pushed `v*` tags on `main`.
- Tag, `package.json`, `CHANGELOG.md`, commit, and artifact identities must match exactly.
- Missing production signing configuration or non-public-trust Authenticode signatures fail closed.
- No test/development signature may enter GitHub Release or npm.
- npm publishes only `artifacts/npm-release/package` on a GitHub-hosted runner using OIDC; long-lived npm write tokens are forbidden.
- User overlay pixels never enter observations, OCR, screenshots, traces, reports, or persisted evidence.
- Windows x64 is the only enabled release target.
- macOS and Linux remain unavailable until their independent native validation passes.

---

### Task 1: PR4 Candidate Closure

**Files:**
- Verify: `src/windows-release-assembly.mjs`
- Verify: `src/phase-0-15-real-release-assembly.mjs`
- Verify: `scripts/windows-release-size-report.mjs`
- Verify: `release/windows-x64-assets.lock.json`

**Interfaces:**
- Consumes: five hash-locked Windows x64 upstream assets.
- Produces: `artifacts/windows-release/<version>/` with the nine-item `blocked_unsigned` candidate inventory.

- [ ] Run focused assembly tests and repair only reproducible failures with RED/GREEN coverage.
- [ ] Rebuild the commit-bound candidate with `npm run phase:0.15`.
- [ ] Verify the real ZIP and target inventory with `npm run release:windows:size-report`.
- [ ] Record exact bytes, hashes, SBOM status, offline install smoke, and protected MCP smoke.

### Task 2: PR5 Release Identity And Signature Gates

**Files:**
- Create: `src/formal-release-policy.mjs`
- Create: `scripts/validate-formal-release.mjs`
- Create: `scripts/verify-authenticode.ps1`
- Test: `test/formal-release-policy.test.mjs`

**Interfaces:**
- Consumes: tag, commit, main ancestry, package metadata, changelog, candidate manifest, Authenticode results.
- Produces: `validateFormalRelease(input)` and a machine-readable fail-closed validation report.

- [ ] Write tests that reject non-`v*` tags, version mismatch, non-main commits, missing changelog headings, candidate/test signatures, missing timestamps, and unexpected publishers.
- [ ] Run the test and observe each missing contract fail.
- [ ] Implement the smallest pure policy and PowerShell signature probe needed to pass.
- [ ] Run focused tests and `git diff --check`.

### Task 3: PR5 Tag-Driven Dual-Channel Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/assemble-formal-release.mjs`
- Create: `scripts/post-publish-smoke.mjs`
- Test: `test/formal-release-workflow.test.mjs`
- Modify: `package.json`
- Modify: `docs/productization/real-release-pipeline-spec.md`

**Interfaces:**
- Consumes: verified PR4 candidate, Azure OIDC signing configuration, asset-manifest production key, npm trusted publisher, `GITHUB_TOKEN`.
- Produces: draft GitHub Release assets, public npm package with provenance, post-publish evidence, then a published prerelease.

- [ ] Write workflow-contract tests for tag-only trigger, least-privilege job permissions, clean Windows runner, Artifact Signing v2, strict secret/variable preflight, draft-first GitHub Release, protected npm staging publish, provenance, and post-publish smoke ordering.
- [ ] Run tests and verify they fail because `release.yml` is absent.
- [ ] Implement jobs `validate`, `build-windows`, `sign-windows`, `assemble`, `draft-github-release`, `publish-npm`, `post-publish-smoke`, and `publish-github-release` with artifact handoffs.
- [ ] Ensure every job fails when required artifacts or signing material are absent and no `continue-on-error` weakens distribution gates.
- [ ] Run YAML parse, workflow-contract tests, and protected npm smoke.

### Task 4: PR6 Runtime Soak Harness

**Files:**
- Create: `src/runtime-soak-runner.mjs`
- Create: `src/phase-8-0-runtime-soak.mjs`
- Test: `test/runtime-soak-runner.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/nightly-soak.yml`

**Interfaces:**
- Consumes: standard MCP server command, duration, client count, request concurrency, fault schedule, resource thresholds.
- Produces: schema-versioned JSON with request/error counts, p95 latency, RSS/handle deltas, child recovery, disconnect cleanup, orphan process count, and overlay exclusion.

- [ ] Write deterministic tests using injected clock/process probes for bounded concurrency, crash/reconnect schedules, resource leak thresholds, cancellation, and orphan detection.
- [ ] Run RED tests.
- [ ] Implement the runner and a CLI with `--duration-ms`, `--clients`, `--concurrency`, and `--faults`.
- [ ] Add a 60-second PR gate and a two-hour scheduled Windows soak; upload reports only, never screenshots or overlay pixels.
- [ ] Run focused tests and a short real local MCP soak.

### Task 5: PR7 Real App And Perception Evidence Harness

**Files:**
- Create: `src/real-app-smoke-runner.mjs`
- Create: `src/phase-6-2-real-app-smoke.mjs`
- Create: `docs/productization/real-app-smoke-catalog.json`
- Test: `test/real-app-smoke-runner.test.mjs`
- Modify: `src/app-smoke-matrix.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: explicit app executable/window matcher, safe fixture, expected capability source, permitted actions, timeout.
- Produces: one signed-off JSON row per attempted real app with machine identity class, actual executable identity, observation provider, timings, action assertions, fail-closed reason, and `includeUserOverlay:false`.

- [ ] Write tests proving declared-only rows cannot pass, missing executables become structured `blocked`, insufficient perception becomes `observation.insufficient`, and guessed coordinates are forbidden.
- [ ] Run RED tests.
- [ ] Implement discovery, launch/session adapter boundaries, evidence validation, and merge into the commercial matrix summary.
- [ ] Add catalog entries for Win32, browser, Electron, WPF, WinForms, Qt, Office/editor, terminal, canvas, and industrial/CAD-like surfaces.
- [ ] Run real local smokes for installed safe applications and preserve only sanitized JSON evidence.
- [ ] Keep unavailable proprietary applications blocked until an approved runner image supplies them; do not relabel them pass.

### Task 6: Full Gate, Integration, And PR Sequence

**Files:**
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: PR4-PR7 reports and all repository tests.
- Produces: reviewable commits/PRs whose status accurately distinguishes implemented gates from external signing and app-lab prerequisites.

- [ ] Run `npm test`, protected npm release smoke, standard MCP client/server smokes, PR4 assembly verification, short soak, and available real-app smokes.
- [ ] Review generated files for source maps, source leakage, secrets, personal paths, screenshots, and user data.
- [ ] Commit each independently reviewable phase.
- [ ] Push the branch and create/update the PR; merge only after required reviews and CI pass.
- [ ] Delete merged local/remote feature branches and begin the next PR from updated `main`.

