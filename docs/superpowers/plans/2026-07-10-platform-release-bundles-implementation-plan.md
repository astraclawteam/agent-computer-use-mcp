# Platform Release Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make release assembly target-aware and reduce the Windows x64 offline ZIP to at most 310 MiB by retaining only Windows x64 ONNX Runtime native files while preserving offline install, trust, rollback, and standard MCP behavior.

**Architecture:** A release-target module owns canonical platform identity. A separate runtime selector validates and prunes production dependency staging before the immutable payload is built. Target identity then flows through payload, offline bundle, SBOM, output manifest, candidate verification, and the hard size gate.

**Tech Stack:** Node.js 24 ESM, Node test runner, PowerShell deterministic ZIP tooling, NativeAOT Windows installer, CycloneDX SBOM, official MCP SDK.

## Global Constraints

- The user-facing npm package remains `agent-computer-use-mcp`.
- Only `windows-x64` is publishable in this plan.
- Canonical target is `{ id: "windows-x64", os: "win32", arch: "x64", libc: null, accelerator: "directml-cpu" }`.
- Windows x64 retains exactly five required ONNX Runtime files under `bin/napi-v6/win32/x64`.
- Darwin, Linux, and Windows ARM64 native runtime files are forbidden.
- Each installable asset has one content-addressed blob; activated views are not embedded in `release/payload`.
- Offline install, repair, activation, rollback, and zero-download first enable must not change.
- Offline ZIP hard limit is `310 * 1024 * 1024` bytes.
- Outputs remain `blocked_unsigned` until PR5 production signing.
- No first-party source or Source Maps enter protected artifacts.

---

### Task 1: Canonical Release Target Contract

**Files:**
- Create: `src/release-target.mjs`
- Create: `test/release-target.test.mjs`

**Interfaces:**
- Produces: `WINDOWS_X64_RELEASE_TARGET`, `resolveReleaseTarget(id)`, `assertReleaseTarget(value)`, `sameReleaseTarget(left, right)`.
- Consumers: Tasks 2-6.

- [ ] **Step 1: Write the failing tests**

```js
test("windows-x64 resolves to the canonical release target", () => {
  assert.deepEqual(resolveReleaseTarget("windows-x64"), {
    id: "windows-x64", os: "win32", arch: "x64", libc: null,
    accelerator: "directml-cpu",
  });
  assert.equal(Object.isFrozen(WINDOWS_X64_RELEASE_TARGET), true);
});

test("unsupported or inconsistent targets fail closed", () => {
  assert.throws(() => resolveReleaseTarget("macos-arm64"), { code: "release.target_unsupported" });
  assert.throws(() => assertReleaseTarget({ ...WINDOWS_X64_RELEASE_TARGET, arch: "arm64" }), {
    code: "release.target_invalid",
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/release-target.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `src/release-target.mjs`.

- [ ] **Step 3: Implement the minimal target module**

```js
export const WINDOWS_X64_RELEASE_TARGET = Object.freeze({
  id: "windows-x64", os: "win32", arch: "x64", libc: null,
  accelerator: "directml-cpu",
});

export function resolveReleaseTarget(id) {
  if (id !== WINDOWS_X64_RELEASE_TARGET.id) {
    throw releaseError("release.target_unsupported", `Unsupported release target: ${id}`);
  }
  return WINDOWS_X64_RELEASE_TARGET;
}

export function assertReleaseTarget(value) {
  if (!sameReleaseTarget(value, WINDOWS_X64_RELEASE_TARGET)) {
    throw releaseError("release.target_invalid", "Release target does not match Windows x64");
  }
  return WINDOWS_X64_RELEASE_TARGET;
}
```

`sameReleaseTarget` compares `id`, `os`, `arch`, `libc`, and `accelerator` only.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/release-target.test.mjs
git add src/release-target.mjs test/release-target.test.mjs
git commit -m "feat: add canonical release target contract"
```

Expected: 2 tests pass.

---

### Task 2: Fail-Closed Windows x64 ONNX Runtime Selector

**Files:**
- Create: `src/release-runtime-selector.mjs`
- Create: `test/release-runtime-selector.test.mjs`

**Interfaces:**
- Consumes: `assertReleaseTarget(target)`.
- Produces: `selectProductionRuntime({ packageRoot, target })` and `WINDOWS_X64_ONNX_REQUIRED_FILES`.
- Report: `{ target, packageVersion, retainedNativeFiles, retainedNativeBytes, removedNativeBytes }`.

- [ ] **Step 1: Write fixture-based failing tests**

Create temporary `onnxruntime-node` native directories for `darwin/arm64`,
`linux/arm64`, `linux/x64`, `win32/arm64`, and `win32/x64`. Put these files in
`win32/x64`:

```js
export const WINDOWS_X64_ONNX_REQUIRED_FILES = Object.freeze([
  "DirectML.dll", "dxcompiler.dll", "dxil.dll", "onnxruntime.dll",
  "onnxruntime_binding.node",
]);
```

Assert selection keeps all five Windows x64 files and deletes the four foreign
targets. Add separate failure tests for:

```text
release.runtime_layout_unsupported
release.runtime_required_file_missing
release.runtime_package_version_unsupported
release.runtime_link_forbidden
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/release-runtime-selector.test.mjs`

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement exact 1.27.0 layout selection**

```js
const SUPPORTED_ONNX_VERSION = "1.27.0";
const KNOWN_NATIVE_TARGETS = new Set([
  "darwin/arm64", "linux/arm64", "linux/x64", "win32/arm64", "win32/x64",
]);
```

Read `onnxruntime-node/package.json`. Inventory with
`readdir({ withFileTypes: true })`, reject links and unknown target directories,
verify all five required files before mutation, remove only four known foreign
directories, then re-inventory and return exact byte metrics.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/release-runtime-selector.test.mjs
git add src/release-runtime-selector.mjs test/release-runtime-selector.test.mjs
git commit -m "feat: select Windows x64 ONNX runtime"
```

---

### Task 3: Integrate Selection Into The Immutable Payload

**Files:**
- Modify: `src/windows-release-payload.mjs`
- Modify: `test/windows-release-payload.test.mjs`
- Modify: `test/windows-installer-build-lock.test.mjs`

**Interfaces:**
- Extends: `buildWindowsReleasePayload({ outputRoot, nodeArchivePath, generatedAt, target })`.
- Produces: payload report fields `target` and `runtimeSelection`.

- [ ] **Step 1: Add failing real-payload assertions**

```js
assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
assert.equal(report.runtimeSelection.packageVersion, "1.27.0");
assert.deepEqual(report.runtimeSelection.retainedNativeFiles, WINDOWS_X64_ONNX_REQUIRED_FILES);
assert.equal(report.files.some((f) => /napi-v6\/(darwin|linux)\//u.test(f.path)), false);
assert.equal(report.files.some((f) => f.path.includes("napi-v6/win32/arm64/")), false);
assert.equal(report.files.some((f) => f.path.endsWith("napi-v6/win32/x64/onnxruntime_binding.node")), true);
assert.deepEqual(descriptor.target, WINDOWS_X64_RELEASE_TARGET);
```

Keep the source-contract test proving release payload reuses
`ensureWindowsInstallerPublished()`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/windows-release-payload.test.mjs test/windows-installer-build-lock.test.mjs
```

Expected: missing target metrics and foreign runtime assertions fail.

- [ ] **Step 3: Select after `npm ci` and before payload copy**

```js
const target = assertReleaseTarget(options.target ?? WINDOWS_X64_RELEASE_TARGET);
await installProductionDependencies(stageRoot, packageRoot);
const runtimeSelection = await selectProductionRuntime({ packageRoot, target });
```

Write `target` into `runtime-entrypoints.json`; return `target` and
`runtimeSelection`. Do not infer target from the build host.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/release-runtime-selector.test.mjs test/windows-release-payload.test.mjs test/windows-installer-build-lock.test.mjs
node -e "import('onnxruntime-node').then(m => { if (!m.InferenceSession) process.exit(1) })"
git add src/windows-release-payload.mjs test/windows-release-payload.test.mjs test/windows-installer-build-lock.test.mjs
git commit -m "feat: slim Windows release runtime payload"
```

---

### Task 4: Propagate Target Identity And Enforce Single Asset Blobs

**Files:**
- Modify: `src/windows-offline-bundle.mjs`
- Modify: `src/release-sbom.mjs`
- Modify: `src/windows-release-assembly.mjs`
- Modify: `test/windows-offline-bundle.test.mjs`
- Modify: `test/release-sbom.test.mjs`
- Modify: `test/windows-release-assembly.test.mjs`

**Interfaces:**
- Extends payload, asset preparation, offline bundle, SBOM, and assembly options with `target`.
- Offline report adds `target`, `blobCount`, and `assetCount`.
- Release identity and candidate metadata add canonical `target`.

- [ ] **Step 1: Write failing propagation and blob tests**

```js
assert.deepEqual(report.target, WINDOWS_X64_RELEASE_TARGET);
assert.equal(report.blobCount, report.assetCount);
assert.deepEqual(candidateMetadata.target, WINDOWS_X64_RELEASE_TARGET);
assert.deepEqual(assetManifest.target, WINDOWS_X64_RELEASE_TARGET);
assert.deepEqual(releaseManifest.release.target, WINDOWS_X64_RELEASE_TARGET);
assert.equal(sbom.metadata.properties.some((p) =>
  p.name === "agent-computer-use.releaseTarget" && p.value === "windows-x64"), true);
```

Expect `release.offline_asset_duplicate` for duplicate IDs. Put
`payload/assets/activated/cua-driver.exe` in a payload fixture and expect
`release.offline_activated_view_forbidden`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/windows-offline-bundle.test.mjs test/release-sbom.test.mjs test/windows-release-assembly.test.mjs
```

- [ ] **Step 3: Implement target flow and one-copy blob inventory**

At each builder boundary:

```js
const target = assertReleaseTarget(options.target ?? WINDOWS_X64_RELEASE_TARGET);
```

Pass target from assembly to payload, SBOM, asset preparation, and bundle. Add
this CycloneDX metadata property:

```js
properties: [{ name: "agent-computer-use.releaseTarget", value: target.id }]
```

Build maps by asset ID and SHA-256; reject duplicate IDs; copy each unique hash
once and report `blobCount`. Inventory payload input and reject paths below
`payload/assets/` or `payload/activated-assets/`.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/release-target.test.mjs test/windows-offline-bundle.test.mjs test/release-sbom.test.mjs test/windows-release-assembly.test.mjs
git add src/windows-offline-bundle.mjs src/release-sbom.mjs src/windows-release-assembly.mjs test/windows-offline-bundle.test.mjs test/release-sbom.test.mjs test/windows-release-assembly.test.mjs
git commit -m "feat: bind release evidence to platform target"
```

---

### Task 5: Add The 310 MiB Hard Gate

**Files:**
- Create: `src/release-size-policy.mjs`
- Create: `test/release-size-policy.test.mjs`
- Modify: `src/windows-release-assembly.mjs`
- Modify: `src/phase-0-15-real-release-assembly.mjs`
- Modify: `test/windows-release-assembly.test.mjs`
- Modify: `test/phase-0-15-real-release-assembly.test.mjs`

**Interfaces:**
- Produces: `WINDOWS_X64_OFFLINE_MAX_BYTES = 310 * 1024 * 1024`.
- Produces: `assertOfflineBundleSize({ target, sizeBytes })`.
- Assembly report adds `offlineBundleSizeBytes` and `offlineBundleMaxBytes`.

- [ ] **Step 1: Write failing boundary tests**

```js
assert.deepEqual(assertOfflineBundleSize({
  target: WINDOWS_X64_RELEASE_TARGET,
  sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
}), {
  sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
  maxBytes: WINDOWS_X64_OFFLINE_MAX_BYTES,
});
assert.throws(() => assertOfflineBundleSize({
  target: WINDOWS_X64_RELEASE_TARGET,
  sizeBytes: WINDOWS_X64_OFFLINE_MAX_BYTES + 1,
}), { code: "release.offline_bundle_too_large" });
```

Create an assembly fixture with a sparse oversized ZIP using `truncate`; assert
promotion never runs.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/release-size-policy.test.mjs test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs
```

- [ ] **Step 3: Implement and invoke the size policy**

Validate a non-negative safe integer. In assembly, stat the actual ZIP, require
the builder report size to match, and apply the policy before copying artifacts.
Apply it again when verifying an existing candidate. Phase 0.15 asserts the
actual and maximum byte fields.

- [ ] **Step 4: Verify GREEN and commit**

```powershell
node --test test/release-size-policy.test.mjs test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs
git add src/release-size-policy.mjs src/windows-release-assembly.mjs src/phase-0-15-real-release-assembly.mjs test/release-size-policy.test.mjs test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs
git commit -m "feat: enforce Windows offline bundle size limit"
```

---

### Task 6: Release Evidence, Documentation, And Real Candidate

**Files:**
- Create: `scripts/windows-release-size-report.mjs`
- Create: `test/windows-release-size-report.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/productization/real-release-pipeline-spec.md`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`

**Interfaces:**
- Produces: `npm run release:windows:size-report` JSON with target, actual/max bytes and MiB, runtime selection metrics, and status.
- CI consumes it after Phase 0.15.

- [ ] **Step 1: Write failing report tests**

Fixture assertions:

```js
assert.equal(report.target.id, "windows-x64");
assert.equal(report.maxMiB, 310);
assert.equal(report.status, "passed");
assert.ok(report.runtimeSelection.removedNativeBytes > 0);
```

Reject missing runtime selection, foreign runtime evidence, and oversized
offline artifacts.

- [ ] **Step 2: Verify RED**

Run: `node --test test/windows-release-size-report.test.mjs`

- [ ] **Step 3: Implement report and update contracts**

Add:

```json
"release:windows:size-report": "node scripts/windows-release-size-report.mjs"
```

The report validates the candidate manifest and payload metrics with the shared
target and size modules. CI runs it after `npm run phase:0.15`. Documentation
states one npm package, per-target GitHub assets, Windows x64 enabled, and all
other targets blocked pending native product evidence.

- [ ] **Step 4: Verify focused contracts and commit**

```powershell
node --test test/windows-release-size-report.test.mjs test/release-target.test.mjs test/release-runtime-selector.test.mjs
npm run phase:0.14
git diff --check
git add README.md CHANGELOG.md package.json .github/workflows/ci.yml docs/productization scripts/windows-release-size-report.mjs test/windows-release-size-report.test.mjs
git commit -m "docs: define target-specific release delivery"
```

- [ ] **Step 5: Build the real candidate**

```powershell
npm run release:windows:assets
npm run release:windows:assemble
npm run release:windows:size-report
npm run phase:0.15
```

If network is unavailable, use only an existing content-addressed cache whose
bytes pass release-lock size and SHA-256 verification. Never add a fixture
fallback. Expected: ZIP at most 310 MiB, zero foreign runtimes, six verified
assets, zero first-enable downloads, offline install and MCP smoke pass.

- [ ] **Step 6: Run complete verification**

```powershell
npm test
npm run phase:0.14
npm run phase:7.8
npm run phase:7.9
npm audit --omit=dev
git diff --check
git status --short --branch
```

Expected: every gate passes and production audit reports zero vulnerabilities.
Generated candidates remain ignored and are never committed.

