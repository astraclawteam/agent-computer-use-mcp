# Agent E2E Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed Agent E2E qualification stage in which Codex, Claude Desktop, Xiaozhi Claw with DeepSeek V4 Flash, and Xiaozhi Claw with Claude Sonnet 5 complete byte-identical natural-language tasks through the released public MCP package.

**Architecture:** PR10A establishes immutable contracts and an environment-only adapter boundary. PR10B adds the orchestration, retry, evidence, and aggregation core. PR10C adds real host drivers without granting them target-application control. PR10D adds qualification task packs, real-run entry points, and the stable-release promotion gate. Phase 6 remains an application harness and cannot produce Agent E2E claims.

**Tech Stack:** Node.js 20 ESM, `node:test`, official `@modelcontextprotocol/sdk`, SHA-256 evidence sealing, Windows x64 host discovery, Playwright/CDP only at the Xiaozhi host UI boundary when supplied by the host.

## Execution Record

- PR10A contract and environment-only adapter boundary: implemented.
- PR10B attempt runner, campaign scheduler, privacy-safe evidence, and aggregation: implemented.
- PR10C real Windows host discovery and bridge-backed drivers: implemented; all four real session bridges remain externally unconfigured and discovery fails closed.
- PR10D task pack, Phase 10 CLI, Phase 9 aggregation, and stable-release gate: implemented.
- Real 3/3 campaigns: not run and not claimed; blocked by `agent_e2e.host_session_bridge_unavailable` for Codex Desktop, Claude Desktop, and both Xiaozhi lanes.

## Global Constraints

- Required lanes are exactly `codex`, `claude-desktop`, `xiaozhi-deepseek-v4-flash`, and `xiaozhi-claude-sonnet-5`.
- Every required task needs `3/3` successful attempts in every lane; only `infrastructure-failure` may receive one retry and the original failure remains sealed.
- Prompts are byte-identical across lanes; no host suffix, element names, coordinates, menu paths, dialog instructions, or action sequence may be stored in a task.
- Environment adapters expose only `discover`, `prepare`, `launch`, `verify`, and `cleanup`.
- Host drivers operate only the agent host; they cannot invoke target application tools, inject tool results, or alter observations.
- Every lane uses the same released public package through official MCP protocol; repository-private routers and direct `cua-driver` calls are forbidden.
- Evidence never seals full screenshots, raw OCR, user documents, credentials, usernames, local user paths, or unrestricted tool payloads.
- Tests and fake drivers prove contracts only. They never set `agentE2eEligible: true`.
- Stable `1.x` promotion requires sealed real-run evidence and `agentE2eEligible: true`; preview releases may report false.

---

### Task 1: PR10A Qualification Contract

**Files:**
- Create: `src/agent-e2e/qualification-contract.mjs`
- Create: `test/agent-e2e-qualification-contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `QUALIFICATION_LANES`, `FAILURE_CLASSES`, `REQUIRED_SUCCESSES`, `INFRASTRUCTURE_RETRY_LIMIT`, `validateQualificationTask(task)`, and `canonicalPrompt(task)`.
- `validateQualificationTask` returns a deeply frozen normalized task or throws a stable `agent_e2e.*` error code.

- [ ] **Step 1: Write the failing contract tests**

```js
test("qualification contract freezes the four required lanes and 3/3 rule", () => {
  assert.deepEqual(QUALIFICATION_LANES, [
    "codex", "claude-desktop", "xiaozhi-deepseek-v4-flash", "xiaozhi-claude-sonnet-5",
  ]);
  assert.equal(REQUIRED_SUCCESSES, 3);
  assert.equal(INFRASTRUCTURE_RETRY_LIMIT, 1);
});

test("task rejects hidden action guidance", () => {
  assert.throws(() => validateQualificationTask({ ...validTask(), coordinates: [10, 20] }),
    /agent_e2e\.task_field_forbidden/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/agent-e2e-qualification-contract.test.mjs`

Expected: FAIL because `src/agent-e2e/qualification-contract.mjs` does not exist.

- [ ] **Step 3: Implement the minimal contract**

```js
export const QUALIFICATION_LANES = Object.freeze([
  "codex", "claude-desktop", "xiaozhi-deepseek-v4-flash", "xiaozhi-claude-sonnet-5",
]);
export const REQUIRED_SUCCESSES = 3;
export const INFRASTRUCTURE_RETRY_LIMIT = 1;
export const FAILURE_CLASSES = Object.freeze([
  "infrastructure-failure", "agent-decision-failure", "perception-failure",
  "action-failure", "verification-failure", "policy-blocked", "cleanup-failure",
]);
```

Validate an allowlist of task fields, reject action-guidance keys recursively, normalize UTF-8 prompt bytes, and compute `promptSha256` with `node:crypto`.

- [ ] **Step 4: Run GREEN and regression tests**

Run: `node --test test/agent-e2e-qualification-contract.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-e2e/qualification-contract.mjs test/agent-e2e-qualification-contract.test.mjs package.json
git commit -m "feat: define agent e2e qualification contract"
```

### Task 2: PR10A Environment-Only Adapter Boundary

**Files:**
- Create: `src/agent-e2e/environment-adapter.mjs`
- Create: `test/agent-e2e-environment-adapter.test.mjs`
- Modify: `docs/productization/app-smoke-matrix.md`
- Modify: `docs/productization/roadmap.md`

**Interfaces:**
- Consumes: normalized task from `validateQualificationTask`.
- Produces: `ENVIRONMENT_ADAPTER_METHODS`, `assertEnvironmentAdapter(adapter)`, and `runEnvironmentLifecycle(adapter, context, executeAgent)`.
- `executeAgent` receives `{ scope, fixture, app }`; cleanup always runs and owns no target action API.

- [ ] **Step 1: Write failing boundary tests**

```js
test("environment adapter rejects observe and act workflows", () => {
  assert.throws(() => assertEnvironmentAdapter({ ...validAdapter(), act() {} }),
    /agent_e2e\.adapter_method_forbidden: act/);
});

test("cleanup runs after an agent failure", async () => {
  const calls = [];
  const result = await runEnvironmentLifecycle(recordingAdapter(calls), {}, async () => {
    throw Object.assign(new Error("failed"), { failureClass: "agent-decision-failure" });
  });
  assert.equal(result.failureClass, "agent-decision-failure");
  assert.equal(calls.at(-1), "cleanup");
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/agent-e2e-environment-adapter.test.mjs`

Expected: FAIL because the environment-only module does not exist.

- [ ] **Step 3: Implement lifecycle and fail-closed method validation**

```js
export const ENVIRONMENT_ADAPTER_METHODS = Object.freeze([
  "discover", "prepare", "launch", "verify", "cleanup",
]);
```

Reject extra function-valued keys and the forbidden names `observe`, `act`, `click`, `type`, `setValue`, `navigate`, `evaluate`, `save`, `closeDialog`, and `selectElement`. Run `discover -> prepare -> launch -> executeAgent -> verify -> cleanup`, preserving cleanup failure as the terminal class.

- [ ] **Step 4: Correct public claims**

State in both docs that Phase 6.2 is application harness evidence only, current scripted adapters are not Agent E2E, and installed applications remain unqualified until Phase 10 evidence exists.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test test/agent-e2e-environment-adapter.test.mjs test/commercial-evidence-docs.test.mjs && npm test`

```bash
git add src/agent-e2e/environment-adapter.mjs test/agent-e2e-environment-adapter.test.mjs docs/productization
git commit -m "feat: enforce environment-only qualification adapters"
```

### Task 3: PR10B Host Driver Boundary And Attempt Runner

**Files:**
- Create: `src/agent-e2e/host-driver.mjs`
- Create: `src/agent-e2e/attempt-runner.mjs`
- Create: `test/agent-e2e-host-driver.test.mjs`
- Create: `test/agent-e2e-attempt-runner.test.mjs`

**Interfaces:**
- Produces: `assertHostDriver(driver)`, `runAgentAttempt(options)`, and `classifyAttemptFailure(evidence)`.
- A host driver exposes exactly `discover`, `createSession`, `configureMcp`, `submitPrompt`, `waitForTerminal`, `collectEvidence`, `cancel`, and `close`.

- [ ] **Step 1: Write failing host-boundary tests**

```js
test("host driver rejects target tool authority", () => {
  assert.throws(() => assertHostDriver({ ...validDriver(), callTool() {} }),
    /agent_e2e\.host_method_forbidden: callTool/);
});
```

- [ ] **Step 2: Run RED, then implement the exact host method allowlist**

Run: `node --test test/agent-e2e-host-driver.test.mjs`

Expected: FAIL for missing module. Implement method validation and reject `callTool`, `clickTarget`, `typeTarget`, `injectToolResult`, `observeTarget`, and `alterObservation`.

- [ ] **Step 3: Write failing attempt-state tests**

Test timeout cancellation, model mismatch, MCP package mismatch, external verification overriding agent prose, and cleanup failure overriding a pass.

- [ ] **Step 4: Run RED, implement, and run GREEN**

Run: `node --test test/agent-e2e-attempt-runner.test.mjs`

Expected RED: missing `runAgentAttempt`; expected GREEN: all attempt-state tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-e2e/host-driver.mjs src/agent-e2e/attempt-runner.mjs test/agent-e2e-host-driver.test.mjs test/agent-e2e-attempt-runner.test.mjs
git commit -m "feat: add agent e2e attempt runner"
```

### Task 4: PR10B Privacy-Safe Qualification Evidence

**Files:**
- Create: `src/agent-e2e/qualification-evidence.mjs`
- Create: `test/agent-e2e-qualification-evidence.test.mjs`

**Interfaces:**
- Produces: `createQualificationEvidenceRun(options)` and `verifyQualificationEvidence(path, expected)`.
- Sealed inventory is exactly `run-manifest.json`, `agent-transcript.jsonl`, `mcp-tool-events.jsonl`, `observation-summary.jsonl`, `verification.json`, `cleanup.json`, and `checksums.txt`.

- [ ] **Step 1: Write failing inventory, immutability, checksum, and privacy tests**

```js
test("qualification evidence rejects raw OCR and local user paths", async () => {
  const run = await createQualificationEvidenceRun(validOptions());
  await assert.rejects(run.appendObservation({ rawOcr: "secret" }), /agent_e2e\.evidence_forbidden/);
  await assert.rejects(run.appendTranscript({ text: "C:\\Users\\someone\\file.txt" }), /agent_e2e\.evidence_forbidden/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/agent-e2e-qualification-evidence.test.mjs`

Expected: FAIL for missing module.

- [ ] **Step 3: Implement atomic writers and sealing**

Reuse the repository's SHA-256/checksum conventions, but enforce the Phase 10 seven-file inventory. Store transcript role/status summaries, classified MCP arguments/results, observation IDs and strategies, never unrestricted payloads.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/agent-e2e-qualification-evidence.test.mjs && npm test`

```bash
git add src/agent-e2e/qualification-evidence.mjs test/agent-e2e-qualification-evidence.test.mjs
git commit -m "feat: seal agent e2e qualification evidence"
```

### Task 5: PR10B Campaign Orchestrator And Aggregation

**Files:**
- Create: `src/agent-e2e/campaign-runner.mjs`
- Create: `src/agent-e2e/qualification-aggregator.mjs`
- Create: `test/agent-e2e-campaign-runner.test.mjs`
- Create: `test/agent-e2e-qualification-aggregator.test.mjs`

**Interfaces:**
- Produces: `runQualificationCampaign(options)` and `evaluateAgentE2eQualification(evidence)`.
- Campaign result contains every original attempt and retry; aggregator returns `agentE2eEligible`, lane/task summaries, violations, and failed run IDs.

- [ ] **Step 1: Write failing scheduler tests**

Prove four lanes, three successful runs, fresh session/workspace/profile IDs, a single infrastructure retry, no retry for the other six classes, and no successful retry hiding the original failed attempt.

- [ ] **Step 2: Run RED, implement the minimal deterministic scheduler, run GREEN**

Run: `node --test test/agent-e2e-campaign-runner.test.mjs`

- [ ] **Step 3: Write failing aggregation tests**

Test `11/12` fails, `12/12` passes only with identical prompt hashes and package identity, any historical non-infrastructure failure fails the campaign, and fake/contract evidence cannot qualify.

- [ ] **Step 4: Run RED, implement aggregation, run GREEN and commit**

Run: `node --test test/agent-e2e-qualification-aggregator.test.mjs && npm test`

```bash
git add src/agent-e2e/campaign-runner.mjs src/agent-e2e/qualification-aggregator.mjs test/agent-e2e-campaign-runner.test.mjs test/agent-e2e-qualification-aggregator.test.mjs
git commit -m "feat: orchestrate agent e2e campaigns"
```

### Task 6: PR10C Real Host Drivers

**Files:**
- Create: `src/agent-e2e/host-drivers/codex-desktop.mjs`
- Create: `src/agent-e2e/host-drivers/claude-desktop.mjs`
- Create: `src/agent-e2e/host-drivers/xiaozhi-web.mjs`
- Create: `src/agent-e2e/host-drivers/windows-host-discovery.mjs`
- Create: `src/phase-10-2-host-discovery.mjs`
- Create: `test/agent-e2e-real-host-drivers.test.mjs`

**Interfaces:**
- Codex driver discovers the signed Codex Desktop package, not a repository fake.
- Claude driver discovers `Claude.exe`; it rejects the `claude`/Claude Code CLI as a Desktop substitute.
- Xiaozhi driver pins URL, backend session identity, provider, and actual returned model ID for each lane.

- [ ] **Step 1: Write failing discovery and identity tests**

Use dependency-injected process/window/browser probes. Assert Claude Code paths are rejected; model display names without actual model identity fail closed; all drivers expose only host-driver methods.

- [ ] **Step 2: Run RED and implement discovery**

Run: `node --test test/agent-e2e-real-host-drivers.test.mjs`

Expected: FAIL for missing drivers. Implement Windows package/process discovery and Xiaozhi health/session probing without any target action method.

- [ ] **Step 3: Add host session transports**

Codex and Claude Desktop use their observable Desktop host session boundary. Xiaozhi uses its host-owned browser semantic interface; no raw Preview Browser CDP endpoint is accepted by this package. Every transport records host build, provider, actual model ID, and released MCP package identity.

- [ ] **Step 4: Run GREEN and a discovery-only local smoke**

Run: `node --test test/agent-e2e-real-host-drivers.test.mjs && node src/phase-10-2-host-discovery.mjs --url http://127.0.0.1:5174/`

Expected: all four lanes report `available` with verifiable identities, or return a precise infrastructure blocker; discovery does not count as qualification.

- [ ] **Step 5: Commit**

```bash
git add src/agent-e2e/host-drivers test/agent-e2e-real-host-drivers.test.mjs src/phase-10-2-host-discovery.mjs
git commit -m "feat: add real qualification host drivers"
```

### Task 7: PR10D Qualification Task Pack And Environment Adapters

**Files:**
- Create: `docs/productization/agent-e2e-task-pack.json`
- Create: `src/agent-e2e/task-pack.mjs`
- Create: `src/agent-e2e/environment-adapters/temporary-text-document.mjs`
- Create: `src/agent-e2e/environment-adapters/temporary-spreadsheet.mjs`
- Create: `src/agent-e2e/environment-adapters/temporary-web-form.mjs`
- Create: `test/agent-e2e-task-pack.test.mjs`
- Create: `test/agent-e2e-environment-adapters.test.mjs`

**Interfaces:**
- Produces: `loadQualificationTaskPack(path)` and environment adapters whose verification reads only external final state.
- Initial pack includes exact text-save, spreadsheet value/formula, presentation structure, web-form/download, Electron editor, system dialog/file chooser, self-drawn/Canvas, multi-window selection, generic intermediate-state recovery, and cancel/revoke/timeout/approval/policy-denial task families.

- [ ] **Step 1: Write failing task-pack lint tests**

Assert canonical prompt SHA-256, schema version, no forbidden hints, no per-lane prompt variants, synthetic fixture scope, and all verifier IDs registered.

- [ ] **Step 2: Run RED, implement loader and initial pack, run GREEN**

Run: `node --test test/agent-e2e-task-pack.test.mjs`

- [ ] **Step 3: Write failing environment-adapter tests**

Test isolated paths/profiles, real process launch arguments, final bytes/structured output verification, and cleanup. Inspect adapters to prove they contain no MCP client, target action, element label, coordinate, menu, or dialog workflow.

- [ ] **Step 4: Run RED, implement adapters, run GREEN and commit**

Run: `node --test test/agent-e2e-environment-adapters.test.mjs && npm test`

```bash
git add docs/productization/agent-e2e-task-pack.json src/agent-e2e/task-pack.mjs src/agent-e2e/environment-adapters test/agent-e2e-task-pack.test.mjs test/agent-e2e-environment-adapters.test.mjs
git commit -m "feat: add agent e2e qualification task pack"
```

### Task 8: PR10D Real Campaign CLI And Stable Promotion Gate

**Files:**
- Create: `src/phase-10-3-agent-e2e-campaign.mjs`
- Create: `src/phase-10-4-agent-e2e-evidence.mjs`
- Modify: `src/commercial-promotion.mjs`
- Modify: `src/phase-9-0-commercial-promotion.mjs`
- Modify: `test/commercial-promotion.test.mjs`
- Create: `test/phase-10-agent-e2e-cli.test.mjs`
- Modify: `package.json`
- Modify: `docs/productization/roadmap.md`

**Interfaces:**
- `npm run phase:10.2` performs discovery only.
- `npm run phase:10.3 -- --release-package <tgz> --platform-package <tgz> --evidence-root <path>` runs real campaigns and refuses workspace-private imports.
- `npm run phase:10.4 -- --evidence <path>` verifies sealed Agent E2E evidence.
- Phase 9 returns `agentE2eEligible` and blocks stable `1.x` without complete Phase 10 evidence.

- [ ] **Step 1: Write failing CLI and promotion tests**

Assert missing released package, fake driver, dirty candidate identity, model fallback, incomplete lane matrix, or missing Phase 10 evidence fails closed. Assert a preview candidate reports `agentE2eEligible: false` without claiming commercial qualification.

- [ ] **Step 2: Run RED**

Run: `node --test test/phase-10-agent-e2e-cli.test.mjs test/commercial-promotion.test.mjs`

Expected: FAIL because Phase 10 CLI and promotion requirement are absent.

- [ ] **Step 3: Implement CLI and promotion integration**

Add package scripts `phase:10.2`, `phase:10.3`, and `phase:10.4`. Bind evidence to released core/platform tarball SHA-256 and actual host/model identity. Keep test drivers tagged `evidenceKind: contract-test` so they can never promote.

- [ ] **Step 4: Run GREEN, full regression, and real discovery**

Run: `node --test test/phase-10-agent-e2e-cli.test.mjs test/commercial-promotion.test.mjs`

Run: `npm test`

Run: `npm run phase:10.2 -- --url http://127.0.0.1:5174/`

Expected: tests PASS; discovery reports real host availability but does not claim Agent E2E success.

- [ ] **Step 5: Execute the real campaign when released package and all host sessions are usable**

Run (PowerShell):

```powershell
$core = (Get-ChildItem dist/npm/agent-computer-use-mcp-*.tgz | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$platform = (Get-ChildItem dist/npm/agent-computer-use-mcp-win32-x64-*.tgz | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
npm run phase:10.3 -- --release-package $core --platform-package $platform --evidence-root evidence/agent-e2e
```

Expected: every required task has twelve sealed successful attempts; any blocker remains reported with its exact failure class and no qualification claim.

- [ ] **Step 6: Verify evidence and promotion**

Run: `npm run phase:10.4 -- --evidence evidence/agent-e2e/<campaign>`

Run (PowerShell):

```powershell
$evidence = Get-ChildItem evidence/pr-soak,evidence/nightly,evidence/release-candidate,evidence/real-app,evidence/perception,evidence/agent-e2e -Directory -Recurse |
  Where-Object { Test-Path (Join-Path $_.FullName checksums.txt) }
$arguments = $evidence | ForEach-Object { @("--evidence", $_.FullName) }
node src/phase-9-0-commercial-promotion.mjs @arguments
```

Expected: stable promotion passes only with matching candidate identity and complete real Agent E2E evidence.

- [ ] **Step 7: Commit**

```bash
git add src/phase-10-*.mjs src/commercial-promotion.mjs test/phase-10-agent-e2e-cli.test.mjs test/commercial-promotion.test.mjs package.json docs/productization/roadmap.md
git commit -m "feat: gate commercial promotion on real agent e2e"
```

### Task 9: Final Verification And PR Sequence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-13-agent-e2e-qualification-implementation.md`

**Interfaces:** None.

- [ ] **Step 1: Run focused and full verification**

Run: `node --test test/agent-e2e-*.test.mjs test/phase-10-agent-e2e-cli.test.mjs test/commercial-promotion.test.mjs`

Run: `npm test`

Run: `git diff --check`

Expected: all PASS and no whitespace errors.

- [ ] **Step 2: Audit forbidden authority and claim language**

Run: `rg -n "Claude Code|clickTarget|typeTarget|injectToolResult|raw CDP|Agent E2E passed|commercially qualified" src/agent-e2e docs/productization test/agent-e2e-*`

Expected: no Claude Code lane, no target-control authority in host/environment adapters, and no unsupported pass claim.

- [ ] **Step 3: Review commits as PR10A through PR10D**

PR10A contains Tasks 1-2, PR10B Tasks 3-5, PR10C Task 6, and PR10D Tasks 7-8. Each PR must preserve a green full suite and may be reviewed independently.

- [ ] **Step 4: Update checklist and finish branch**

Mark completed tasks in this plan only after the corresponding commands have actually passed. Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`.
