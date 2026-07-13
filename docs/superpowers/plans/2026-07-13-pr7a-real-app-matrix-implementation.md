# PR7A Real Application Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace optional declaration-style application coverage with repeatable Tier A fixtures and sanitized Tier B evidence from software actually installed on the Windows app-lab machine.

**Architecture:** Introduce a strict catalog schema and adapter registry. Each adapter owns discovery, temporary workspace creation, harmless action, state verification, and cleanup; the runner owns retries, overlay lifecycle, evidence events, and aggregation. Fixture binaries are resolved from a separate hash-locked pack and never enter public packages.

**Tech Stack:** Node.js 20+ ESM, official MCP SDK, cua-driver MCP, Windows UIA, .NET fixtures, GitHub Actions self-hosted Windows runner.

## Global Constraints

- PR6A is merged first; application attempts are written through its evidence core.
- Tier A must pass completely; `not-installed`, `insufficient-perception`, and `infrastructure-error` never count as pass.
- A real-app scenario retries at most once and retains both attempts.
- Every action targets a runner-created temporary document or public fixture.
- WeChat and WeCom are policy-only; no conversation, contact, or message content is observed or stored.
- Full-window screenshots and absolute executable paths are excluded from evidence.

---

### Task 1: Freeze the catalog and result vocabulary

**Files:**
- Create: `src/real-app-catalog.mjs`
- Create: `test/real-app-catalog.test.mjs`
- Modify: `docs/productization/real-app-smoke-catalog.json`

**Interfaces:**
- Produces: `parseRealAppCatalog(value) -> RealAppCatalog`.
- Entry fields include `role`, `adapter`, `requiredCategory`, `executableCandidates`, `expectedStatus`, and `privacyClass`.

- [ ] **Step 1: Write failing schema tests**

```js
test("catalog requires explicit evidence roles and never hides missing coverage", () => {
  assert.throws(() => parseRealAppCatalog({ schemaVersion: 2, apps: [{ appId: "x", required: false }] }), /app.catalog_role_required/);
});

test("catalog contains every approved Tier A and installed Tier B category", () => {
  const catalog = parseRealAppCatalog(rawCatalog);
  assert.deepEqual(new Set(catalog.apps.filter(a => a.role === "required-fixture").map(a => a.category)), tierACategories);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test test/real-app-catalog.test.mjs`

Expected: FAIL because the schema module and explicit roles do not exist.

- [ ] **Step 3: Implement schema version 2 and migrate the catalog**

Add Tier A entries for Notepad, Native Lab, WPF, Qt, Edge, Chrome, Canvas, Skia/ImGui, CAD-like, and timeline. Add Tier B entries for VS Code, LibreOffice Writer/Calc/Impress/Draw, WPS, Edge, and Chrome. Add policy-only WeChat and WeCom entries.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/real-app-catalog.test.mjs
git add src/real-app-catalog.mjs test/real-app-catalog.test.mjs docs/productization/real-app-smoke-catalog.json
git commit -m "feat: freeze commercial real app catalog"
```

### Task 2: Introduce the adapter lifecycle contract

**Files:**
- Create: `src/app-adapters/adapter-contract.mjs`
- Create: `src/app-adapters/index.mjs`
- Create: `test/app-adapter-contract.test.mjs`

**Interfaces:**
- Adapter methods: `discover(context)`, `prepare(context)`, `launch(context, fixture)`, `observe(context, app)`, `act(context, observation)`, `verify(context, action)`, and `cleanup(context)`.
- Produces: `runAppAdapter(adapter, context) -> Promise<AppAttempt>`.

- [ ] **Step 1: Write failing lifecycle tests**

Assert exact method order, cleanup after failures in every method, first-error preservation, no action without a control lease, and rejection when `verify` returns only a successful click without final state evidence.

- [ ] **Step 2: Run RED**

Run: `node --test test/app-adapter-contract.test.mjs`

Expected: FAIL because the adapter contract does not exist.

- [ ] **Step 3: Implement the lifecycle runner**

Require a structured `finalState` with `kind` equal to `file-bytes`, `accessibility-value`, `window-state`, or `policy-event`. Sanitize executable identity to file name, version, size, and SHA-256. Return one of the six approved result statuses.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/app-adapter-contract.test.mjs
git add src/app-adapters/adapter-contract.mjs src/app-adapters/index.mjs test/app-adapter-contract.test.mjs
git commit -m "feat: add real application adapter lifecycle"
```

### Task 3: Productize Tier A fixture resolution

**Files:**
- Create: `docs/productization/app-fixture-pack.lock.json`
- Create: `src/app-fixture-pack.mjs`
- Create: `scripts/verify-app-fixture-pack.mjs`
- Create: `test/app-fixture-pack.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `resolveFixturePack({ lock, root }) -> Promise<FixturePack>`.

- [ ] **Step 1: Write failing identity tests**

Test exact target, size, SHA-256, license presence, traversal rejection, symlink/reparse-point rejection, duplicate Windows case-folded paths, and missing fixture categories.

- [ ] **Step 2: Run RED**

Run: `node --test test/app-fixture-pack.test.mjs`

Expected: FAIL because fixture-pack verification does not exist.

- [ ] **Step 3: Implement offline-only resolution**

Resolve `AGENT_COMPUTER_USE_FIXTURE_PACK` or `artifacts/app-fixtures/current`; never download. The lock names WPF, Qt, Skia/ImGui, CAD-like, and timeline executables plus license files. Ignore `/artifacts/app-fixtures/`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/app-fixture-pack.test.mjs
git add .gitignore docs/productization/app-fixture-pack.lock.json src/app-fixture-pack.mjs scripts/verify-app-fixture-pack.mjs test/app-fixture-pack.test.mjs
git commit -m "feat: verify the application fixture pack"
```

### Task 4: Implement Tier A adapters

**Files:**
- Create: `src/app-adapters/notepad.mjs`
- Create: `src/app-adapters/native-fixture.mjs`
- Create: `src/app-adapters/browser-fixture.mjs`
- Create: `src/app-adapters/visual-fixture.mjs`
- Create: `test/tier-a-app-adapters.test.mjs`
- Modify: `src/real-cua-notepad-file-sequence.mjs`
- Modify: `src/real-cua-winforms-file-sequence.mjs`

**Interfaces:**
- Registers adapters `notepad-file`, `native-form`, `browser-local`, and `visual-fixture`.

- [ ] **Step 1: Write failing adapter tests**

Use fake MCP transports around real temporary files to prove element-token actions, exact file verification, browser profile isolation, overlay exclusion, no guessed coordinates, and cleanup of every launched PID.

- [ ] **Step 2: Run RED**

Run: `node --test test/tier-a-app-adapters.test.mjs`

Expected: FAIL because adapters are not registered and existing scripts own lifecycle directly.

- [ ] **Step 3: Extract existing Notepad/Native Lab behavior and add fixtures**

Move reusable flows behind adapters without changing cua-driver semantics. Browser adapters use local `file:` fixtures and isolated profiles. Visual fixtures may return `insufficient-perception` only when the catalog explicitly expects it; Commercial 1.0 later requires PR7C metrics before promotion.

- [ ] **Step 4: Run GREEN and real local Tier A smoke**

Run: `node --test test/tier-a-app-adapters.test.mjs test/real-app-smoke-runner.test.mjs`

Run on prepared app-lab: `npm run phase:6.2 -- --role required-fixture`

Expected: tests pass; the environment command emits explicit pass/failure per Tier A entry.

- [ ] **Step 5: Commit**

```bash
git add src/app-adapters src/real-cua-notepad-file-sequence.mjs src/real-cua-winforms-file-sequence.mjs test/tier-a-app-adapters.test.mjs
git commit -m "feat: run Tier A application adapters"
```

### Task 5: Implement installed browser, Electron, and Office adapters

**Files:**
- Create: `src/app-adapters/vscode.mjs`
- Create: `src/app-adapters/libreoffice.mjs`
- Create: `src/app-adapters/wps-office.mjs`
- Create: `test/installed-app-adapters.test.mjs`

**Interfaces:**
- Registers `vscode-workspace`, `libreoffice-writer`, `libreoffice-calc`, `libreoffice-impress`, `libreoffice-draw`, and `wps-document`.

- [ ] **Step 1: Write failing installed-app tests**

Assert isolated VS Code `--user-data-dir` and `--extensions-dir`; LibreOffice `-env:UserInstallation=file:///...`; WPS temporary document paths; no recent-file access; exact saved-file or accessibility-value verification; and cleanup after first-run dialogs.

- [ ] **Step 2: Run RED**

Run: `node --test test/installed-app-adapters.test.mjs`

Expected: FAIL because the installed adapters do not exist.

- [ ] **Step 3: Implement harmless flows**

VS Code opens a generated workspace, edits one text file, invokes Save through semantic elements, and verifies bytes. LibreOffice components create one document each and verify text/cell/title/drawing-object state through accessibility plus exported temporary output. WPS performs a generated document edit and save without touching recent files.

- [ ] **Step 4: Run GREEN and app-lab evidence**

Run: `node --test test/installed-app-adapters.test.mjs`

Run on the current machine: `npm run phase:6.2 -- --role installed-evidence`

Expected: unavailable software is `not-installed`; installed software produces real attempts and sanitized evidence.

- [ ] **Step 5: Commit**

```bash
git add src/app-adapters/vscode.mjs src/app-adapters/libreoffice.mjs src/app-adapters/wps-office.mjs test/installed-app-adapters.test.mjs
git commit -m "feat: validate installed editor and office applications"
```

### Task 6: Add privacy-only adapters

**Files:**
- Create: `src/app-adapters/privacy-window.mjs`
- Create: `test/privacy-window-adapter.test.mjs`

- [ ] **Step 1: Write failing privacy tests**

Assert that WeChat/WeCom adapters may call `list_windows` and policy evaluation only; reject screenshot, OCR, `get_window_state` with content, click, type, set-value, hotkey, and artifact writes.

- [ ] **Step 2: Run RED**

Run: `node --test test/privacy-window-adapter.test.mjs`

Expected: FAIL because no constrained privacy adapter exists.

- [ ] **Step 3: Implement window-identity and policy-event verification**

The only passing final state is a `policy-event` proving capture/action denial for the matched application identity. Store no title beyond an application-owned fixed prefix.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test test/privacy-window-adapter.test.mjs
git add src/app-adapters/privacy-window.mjs test/privacy-window-adapter.test.mjs
git commit -m "feat: prove privacy application policy boundaries"
```

### Task 7: Replace optional aggregation with evidence aggregation

**Files:**
- Modify: `src/real-app-smoke-runner.mjs`
- Modify: `src/phase-6-2-real-app-smoke.mjs`
- Modify: `test/real-app-smoke-runner.test.mjs`
- Modify: `.github/workflows/real-app-smoke.yml`
- Modify: `package.json`

- [ ] **Step 1: Write failing anti-gaming tests**

Assert all attempts are retained, missing installed software is `not-installed`, repeated transient failure becomes `product-failure`, `required:false` is rejected by schema v2, coverage counts include every status, and artifact upload contains evidence JSON/JSONL/checksums only.

- [ ] **Step 2: Run RED**

Run: `node --test test/real-app-smoke-runner.test.mjs`

Expected: FAIL because the current runner collapses attempts and treats missing apps as `blocked` with optional suppression.

- [ ] **Step 3: Wire adapters and evidence core**

Add `--role`, `--evidence-root`, and `--app-id` CLI filters. Keep filters visible in the manifest; filtered runs cannot claim full-matrix status. Update the workflow to verify fixture pack first and upload sealed evidence with `if: always()`.

- [ ] **Step 4: Run focused and full verification**

Run: `node --test test/real-app-catalog.test.mjs test/app-adapter-contract.test.mjs test/app-fixture-pack.test.mjs test/tier-a-app-adapters.test.mjs test/installed-app-adapters.test.mjs test/privacy-window-adapter.test.mjs test/real-app-smoke-runner.test.mjs`

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/real-app-smoke-runner.mjs src/phase-6-2-real-app-smoke.mjs test/real-app-smoke-runner.test.mjs .github/workflows/real-app-smoke.yml package.json
git commit -m "feat: seal the real application evidence matrix"
```

### Task 8: Update the public matrix from evidence only

**Files:**
- Modify: `docs/productization/app-smoke-matrix.md`
- Modify: `docs/productization/roadmap.md`
- Create: `scripts/render-app-smoke-matrix.mjs`
- Create: `test/render-app-smoke-matrix.test.mjs`

- [ ] **Step 1: Write a failing renderer test**

Assert that rows are generated from verified evidence, `not-installed` remains visible, no absolute path appears, and hand-edited `pass` values are overwritten by evidence state.

- [ ] **Step 2: Run RED, implement renderer, and run GREEN**

Run: `node --test test/render-app-smoke-matrix.test.mjs`

Expected before implementation: FAIL. Expected after implementation: PASS.

- [ ] **Step 3: Final verification and commit**

Run: `npm test`

Run: `git diff --check`

```bash
git add docs/productization/app-smoke-matrix.md docs/productization/roadmap.md scripts/render-app-smoke-matrix.mjs test/render-app-smoke-matrix.test.mjs
git commit -m "docs: render application coverage from evidence"
```
