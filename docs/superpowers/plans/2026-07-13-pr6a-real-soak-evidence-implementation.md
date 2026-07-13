# PR6A Real Soak Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the declaration-style short soak with a real 15-minute MCP daemon run that produces crash-surviving, identity-bound, privacy-safe evidence.

**Architecture:** Add a small evidence core that owns manifests, JSONL events, checksums, sealing, and verification. Refactor the existing soak runner to emit events while retaining dependency injection for fast unit tests, and add a Windows process-tree probe for resources, ports, and cleanup. The phase command may run short in developer mode, but only an exact 900,000 ms run can claim the `pull-request` gate.

**Tech Stack:** Node.js 20+ ESM, official `@modelcontextprotocol/sdk`, Windows PowerShell process probes, Node test runner, GitHub Actions.

## Global Constraints

- Pull-request evidence duration is exactly 900,000 ms.
- RSS net growth is at most 134,217,728 bytes and handle net growth is at most 128.
- Tool-call failure rate is below 0.001; orphan process, residual port, overlay leak, and cursor leak counts are zero.
- Evidence never contains a token, user name, home path, host name, IP address, complete screenshot, or user document.
- `qlogicagent` and Preview Browser code are out of scope.

---

### Task 1: Freeze the evidence directory contract

**Files:**
- Create: `src/commercial-evidence.mjs`
- Create: `test/commercial-evidence.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `createEvidenceRun(options) -> Promise<EvidenceRun>`.
- Produces: `EvidenceRun.append(type, payload)`, `EvidenceRun.checkpoint(payload)`, and `EvidenceRun.seal(report)`.
- Produces: `verifyEvidenceDirectory(path, expected?) -> Promise<EvidenceVerification>`.

- [ ] **Step 1: Write failing contract tests**

```js
test("evidence survives checkpoints and seals an immutable inventory", async () => {
  const run = await createEvidenceRun({ root, runId: "run-1", manifest: validManifest });
  await run.append("runtime.sample", { rssBytes: 42, userName: undefined });
  await run.checkpoint({ round: 1 });
  const sealed = await run.seal({ status: "passed", gate: "pull-request" });
  assert.deepEqual(sealed.files.map((item) => item.path), [
    "events.jsonl", "report.json", "run-manifest.json",
  ]);
  assert.equal((await verifyEvidenceDirectory(run.path)).status, "passed");
});

test("evidence rejects secrets absolute user paths and unreferenced files", async () => {
  await assert.rejects(
    () => createEvidenceRun({ root, runId: "run-2", manifest: { ...validManifest, token: "ghp_secret" } }),
    /evidence.forbidden_metadata/,
  );
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/commercial-evidence.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/commercial-evidence.mjs`.

- [ ] **Step 3: Implement the evidence core**

Implement atomic manifest/report writes, append-only JSONL events, SHA-256 inventory generation, path normalization, forbidden-key/value scanning, and fail-closed verification. Write `checksums.txt` last and exclude it from its own inventory. Add `/evidence/` to `.gitignore`.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/commercial-evidence.test.mjs`

Expected: all evidence tests PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore src/commercial-evidence.mjs test/commercial-evidence.test.mjs
git commit -m "feat: add immutable commercial evidence core"
```

### Task 2: Add deterministic commercial runtime metrics

**Files:**
- Create: `src/commercial-runtime-metrics.mjs`
- Create: `test/commercial-runtime-metrics.test.mjs`

**Interfaces:**
- Produces: `buildRuntimeMetrics({ samples, calls, cleanup }) -> RuntimeMetrics`.
- Produces: `evaluateRuntimeTargets(metrics, targets?) -> Violation[]`.

- [ ] **Step 1: Write failing metric tests**

```js
test("runtime targets allow less than 0.1 percent failures and reject the boundary", () => {
  assert.equal(evaluateRuntimeTargets(metrics({ total: 1001, failed: 1 })).length, 0);
  assert.match(evaluateRuntimeTargets(metrics({ total: 1000, failed: 1 }))[0].code, /failure_rate/);
});

test("runtime metrics report net peak and least-squares slope", () => {
  const result = buildRuntimeMetrics({
    samples: [{ elapsedMs: 0, rssBytes: 100, handles: 10 }, { elapsedMs: 10_000, rssBytes: 200, handles: 20 }],
    calls: [], cleanup: cleanCleanup,
  });
  assert.equal(result.rss.netGrowthBytes, 100);
  assert.equal(result.rss.peakBytes, 200);
  assert.ok(result.rss.slopeBytesPerHour > 0);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/commercial-runtime-metrics.test.mjs`

Expected: FAIL because the metrics module does not exist.

- [ ] **Step 3: Implement metric calculations**

Use exact integer counts, nearest-rank P50/P95/P99, net and peak resources, and least-squares slopes over elapsed hours. Emit stable violation codes for RSS, handles, failures, orphan processes, residual ports, overlay leaks, cursor leaks, and non-fail-closed policy errors.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/commercial-runtime-metrics.test.mjs`

```bash
git add src/commercial-runtime-metrics.mjs test/commercial-runtime-metrics.test.mjs
git commit -m "feat: calculate commercial soak thresholds"
```

### Task 3: Probe owned Windows resources and cleanup

**Files:**
- Create: `src/windows-runtime-probe.mjs`
- Create: `test/windows-runtime-probe.test.mjs`

**Interfaces:**
- Produces: `probeOwnedRuntime({ rootPids, runPowerShell? }) -> Promise<RuntimeProbe>`.
- `RuntimeProbe` contains process identities, aggregate RSS/handles, owned TCP listeners, overlay processes, and cursor processes.

- [ ] **Step 1: Write failing parser and sanitization tests**

```js
test("probe follows descendants and reports only their listening ports", async () => {
  const result = await probeOwnedRuntime({ rootPids: [10], runPowerShell: fixtureProbe });
  assert.deepEqual(result.processIds, [10, 11]);
  assert.deepEqual(result.listeningPorts, [43123]);
  assert.equal(result.processes[0].commandLine, undefined);
});

test("probe rejects non-positive and duplicate roots", async () => {
  await assert.rejects(() => probeOwnedRuntime({ rootPids: [0] }), /runtime.probe_pid_invalid/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/windows-runtime-probe.test.mjs`

Expected: FAIL because the probe module does not exist.

- [ ] **Step 3: Implement one bounded PowerShell probe**

Use `Get-CimInstance Win32_Process`, `Get-Process`, and `Get-NetTCPConnection -State Listen`; compute descendants in PowerShell and return compact JSON. Never return command lines or executable absolute paths from the public result. Spawn with `windowsHide: true`, `shell: false`, and a 10-second timeout.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test test/windows-runtime-probe.test.mjs`

```bash
git add src/windows-runtime-probe.mjs test/windows-runtime-probe.test.mjs
git commit -m "feat: probe owned Windows runtime resources"
```

### Task 4: Refactor the soak runner around real events

**Files:**
- Modify: `src/runtime-soak-runner.mjs`
- Modify: `test/runtime-soak-runner.test.mjs`

**Interfaces:**
- `runRuntimeSoak(options) -> Promise<RuntimeSoakReport>` accepts `eventSink`, `sampleIntervalMs`, `probeRuntime`, `scenarioSeed`, and `gate`.
- Existing `createSession`, `now`, and `sleep` injection remains available only for unit tests.

- [ ] **Step 1: Add failing lifecycle tests**

Add tests proving that sampling occurs every interval, both failed and successful attempts are emitted, cleanup runs after session creation/call/fault failures, policy errors are classified separately, and the final report uses `evaluateRuntimeTargets` rather than `failedCalls > 0`.

- [ ] **Step 2: Run RED**

Run: `node --test test/runtime-soak-runner.test.mjs`

Expected: FAIL because no samples/events/cleanup probe are emitted and one failed call currently always fails the run.

- [ ] **Step 3: Implement the event-driven loop**

Keep read-only calls as the baseline, add deterministic cancel/revoke/timeout scenarios through an explicit scenario table, sample the complete process tree, and retain every latency/call outcome. Ensure all sessions close before the cleanup probe and preserve the first cleanup error as evidence.

- [ ] **Step 4: Run GREEN and the MCP integration test**

Run: `node --test test/runtime-soak-runner.test.mjs test/phase-1-7-standard-mcp-client.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime-soak-runner.mjs test/runtime-soak-runner.test.mjs
git commit -m "refactor: emit real runtime soak evidence"
```

### Task 5: Seal Phase 8.0 evidence and enforce the PR gate

**Files:**
- Modify: `src/phase-8-0-runtime-soak.mjs`
- Create: `scripts/verify-commercial-evidence.mjs`
- Create: `test/phase-8-0-commercial-soak.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Adds `npm run soak:pr` and `npm run evidence:verify`.
- Phase arguments add `--gate`, `--evidence-root`, and `--seed`.

- [ ] **Step 1: Write failing CLI/workflow tests**

Assert that `--gate pull-request` rejects any duration other than `900000`, the evidence verifier rejects a dirty or mismatched commit, and CI invokes `npm run soak:pr` with artifact upload on failure or success.

- [ ] **Step 2: Run RED**

Run: `node --test test/phase-8-0-commercial-soak.test.mjs test/ci-workflow.test.mjs`

Expected: FAIL because the CLI has no gate/evidence options and CI still runs 60 seconds.

- [ ] **Step 3: Implement CLI sealing and CI**

`soak:pr` must run `node src/phase-8-0-runtime-soak.mjs --gate pull-request --duration-ms 900000 --evidence-root evidence/pr-soak`. Upload only the sealed JSON/JSONL/checksum directory with 30-day retention; reject PNG/JPEG files in the workflow contract test.

- [ ] **Step 4: Verify focused and full suites**

Run: `node --test test/commercial-evidence.test.mjs test/commercial-runtime-metrics.test.mjs test/windows-runtime-probe.test.mjs test/runtime-soak-runner.test.mjs test/phase-8-0-commercial-soak.test.mjs test/ci-workflow.test.mjs`

Run: `npm test`

Expected: all tests PASS. Do not run the 15-minute gate as part of the local unit suite.

- [ ] **Step 5: Commit**

```bash
git add src/phase-8-0-runtime-soak.mjs scripts/verify-commercial-evidence.mjs test/phase-8-0-commercial-soak.test.mjs package.json .github/workflows/ci.yml
git commit -m "ci: require real pull request soak evidence"
```

### Task 6: Document and review PR6A

**Files:**
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/roadmap.md`
- Modify: `README.md`
- Create: `test/commercial-evidence-docs.test.mjs`

- [ ] **Step 1: Add a failing documentation contract test**

Create `test/commercial-evidence-docs.test.mjs` asserting the exact 15-minute duration, thresholds, evidence paths, privacy exclusions, and verification command.

- [ ] **Step 2: Run RED, update docs, and run GREEN**

Run: `node --test test/commercial-evidence-docs.test.mjs`

Expected before docs: FAIL. Expected after docs: PASS.

- [ ] **Step 3: Final verification**

Run: `npm test`

Run: `git diff --check`

Expected: all tests pass and the worktree contains only intended changes.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/productization/release-gates.md docs/productization/roadmap.md test/commercial-evidence-docs.test.mjs
git commit -m "docs: define PR soak evidence operations"
```
