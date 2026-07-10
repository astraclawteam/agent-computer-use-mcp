# Real Windows Release Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable Windows x64 release candidate from real protected runtime, native helpers, portable Node.js, pinned third-party assets, checksums, and a CycloneDX SBOM without publishing or using production signing credentials.

**Architecture:** A checked-in immutable asset lock is the build input. Release assembly acquires exact bytes into an ignored content-addressed cache, builds the protected MCP and native helpers, creates the release payload and offline asset tree, and emits one candidate artifact set. The current NativeAOT installer remains the sole installation-state writer; candidate asset manifests use explicit development trust and are always marked distribution-blocked so PR5 can replace only the signing/final publication layer.

**Tech Stack:** Node.js 24 release tooling, npm 11, `yaml@2.9.0` as a build-only parser, .NET 10 NativeAOT, WinForms/WebView2 overlay, PowerShell/.NET deterministic ZIP helpers, official `@modelcontextprotocol/sdk` smoke clients.

## Global Constraints

- Initial platform is exactly `windows-x64`.
- Formal artifact names derive from `package.json` version; candidate output adds `.candidate` metadata and is not distributable.
- The source workspace remains non-publishable; only the protected staging package supplies first-party JavaScript.
- Candidate assembly uses real upstream bytes and exact SHA-256 verification. It has no tiny-fixture or missing-asset fallback.
- Generated downloads, models, native outputs, caches, ZIPs, SBOMs, and manifests stay under ignored `artifacts/` roots.
- The GitHub Windows channel includes portable Node.js; it does not depend on machine-wide Node.js.
- No component is downloaded during first enable. All network access finishes before the offline install smoke starts.
- First-party PE files are unsigned candidates in PR4 and must report `distributionStatus: "blocked_unsigned"`.
- Test/development asset trust must report `developmentOnly: true` and cannot be renamed into a formal artifact.
- Production Authenticode, GitHub Release, npm publishing, and provenance belong to PR5.
- The user overlay remains excluded from observations, OCR inputs, traces, artifacts, and all release reports.

## File Structure

- `release/windows-x64-assets.lock.json`: immutable upstream asset identity, hashes, sizes, revisions, licenses, and install roles.
- `src/release-asset-lock.mjs`: parse and fail-closed validation for the asset lock.
- `src/release-asset-acquirer.mjs`: exact-hash network/offline acquisition into an ignored content-addressed cache.
- `src/windows-release-payload.mjs`: build protected MCP runtime, production dependency tree, portable Node.js tree, overlay, installer, and release bundle.
- `src/ocr-release-model-pack.mjs`: parse the official PaddlePaddle recognition metadata and materialize the exact ONNX model pack and dictionary.
- `src/windows-offline-bundle.mjs`: create actual asset archives, candidate asset trust, and deterministic offline ZIP layout.
- `src/release-sbom.mjs`: generate and augment the CycloneDX SBOM.
- `src/release-output-manifest.mjs`: hash final outputs, write release manifest, and write sorted checksums.
- `src/windows-release-assembly.mjs`: orchestrate acquisition, payload, offline bundle, SBOM, hashes, and cleanup.
- `scripts/create-deterministic-zip.ps1`: sorted ZIP writer with fixed timestamps and no traversal.
- `scripts/build-windows-release-candidate.mjs`: maintainer command for real candidate assembly.
- `src/phase-0-15-real-release-assembly.mjs`: commercial gate that assembles and installs the real candidate.
- `test/release-asset-lock.test.mjs`: lock schema and pinned identity tests.
- `test/release-asset-acquirer.test.mjs`: acquisition identity, corruption, and no-network tests.
- `test/windows-release-payload.test.mjs`: real payload structure and source-exclusion tests.
- `test/ocr-release-model-pack.test.mjs`: official metadata-to-dictionary/model-pack tests.
- `test/windows-offline-bundle.test.mjs`: offline layout and candidate trust tests.
- `test/release-sbom.test.mjs`: SBOM component and privacy tests.
- `test/release-output-manifest.test.mjs`: artifact hash and checksum tests.
- `test/windows-release-assembly.test.mjs`: orchestration, cleanup, and distribution-block tests.
- `test/phase-0-15-real-release-assembly.test.mjs`: executable install/MCP/offline gate.

---

### Task 1: Immutable Windows Asset Lock

**Files:**
- Create: `release/windows-x64-assets.lock.json`
- Create: `src/release-asset-lock.mjs`
- Create: `test/release-asset-lock.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `loadReleaseAssetLock(path): Promise<ReleaseAssetLock>`.
- Produces: `validateReleaseAssetLock(lock): { status, violations, assets }`.
- `ReleaseAssetLock.assets[]` has `{ id, version, source, sha256, sizeBytes, license, install }`.

- [x] **Step 1: Add the build-only YAML dependency**

Run:

```powershell
npm install --save-dev --save-exact yaml@2.9.0
```

Expected: `yaml` appears only in `devDependencies`; protected npm package dependencies remain unchanged.

- [x] **Step 2: Write failing lock validation tests**

Create tests that assert the checked-in lock contains exactly these pinned sources:

```js
const expected = new Map([
  ["node-runtime-windows-x64", ["24.12.0", 36361909, "9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812"]],
  ["cua-driver-windows-x64", ["0.7.1", 7762316, "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab"]],
  ["ocr-model-pp-ocrv6-small-det", ["28fe5895c24fd108c19eb3e8479f4ab385fbfc62", 9880512, "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e"]],
  ["ocr-model-pp-ocrv6-small-rec", ["b8f84f0b80c529de40b4fbb3544b84fa7233a513", 21159378, "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634"]],
  ["ocr-model-pp-ocrv6-small-rec-metadata", ["b8f84f0b80c529de40b4fbb3544b84fa7233a513", 150579, "ab078671bb49f06228eadccd34f1bb501e157f7a047095ffb943ba81512c77d1"]],
  ["webview2-evergreen-standalone-windows-x64", ["1.3.241.15", 203654864, "3a08103bed8a3d9aefdfc9ac10a672ea69605163f2dcb08d76cfd3e0444511c9"]],
]);
```

Also assert rejection of duplicate IDs, non-HTTPS URLs, credential-bearing URLs, malformed SHA-256, zero sizes, missing SPDX/license evidence, unsupported platform, and a floating revision without exact hash and version.

- [x] **Step 3: Run the test and verify RED**

Run:

```powershell
node --test test/release-asset-lock.test.mjs
```

Expected: FAIL because `release/windows-x64-assets.lock.json` and `src/release-asset-lock.mjs` do not exist.

- [x] **Step 4: Add the exact lock and validator**

The lock uses schema version `1`, platform `windows-x64`, the exact values above, and these sources:

```text
https://nodejs.org/dist/v24.12.0/node-v24.12.0-win-x64.zip
https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.7.1/cua-driver-rs-0.7.1-windows-x86_64.zip
https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx
https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.onnx
https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/resolve/b8f84f0b80c529de40b4fbb3544b84fa7233a513/inference.yml
https://go.microsoft.com/fwlink/?linkid=2124701
```

`validateReleaseAssetLock` normalizes no values. It returns violations and `loadReleaseAssetLock` throws `release.asset_lock_invalid` when any violation exists.

- [x] **Step 5: Run focused tests and commit**

Run:

```powershell
node --test test/release-asset-lock.test.mjs
git add package.json package-lock.json release/windows-x64-assets.lock.json src/release-asset-lock.mjs test/release-asset-lock.test.mjs
git commit -m "feat: lock real Windows release assets"
```

Expected: PASS; one focused commit.

### Task 2: Exact Content-Addressed Release Acquisition

**Files:**
- Create: `src/release-asset-acquirer.mjs`
- Create: `scripts/fetch-windows-release-assets.mjs`
- Create: `test/release-asset-acquirer.test.mjs`

**Interfaces:**
- Consumes: validated `ReleaseAssetLock` from Task 1.
- Produces: `acquireReleaseAssets({ lock, cacheRoot, allowNetwork, fetchImpl, onProgress }): Promise<AcquiredAsset[]>`.
- `AcquiredAsset` is `{ id, version, path, sizeBytes, sha256, cacheHit, sourceUrl }`.

- [x] **Step 1: Write failing acquisition tests**

Tests use a local in-memory fetch adapter and assert:

```js
assert.equal(result[0].path, join(cacheRoot, "sha256", hash.slice(0, 2), hash, "blob"));
assert.equal(result[0].cacheHit, false);
assert.equal((await acquireAgain())[0].cacheHit, true);
await assert.rejects(() => acquireCorrupt(), /release\.asset_hash_mismatch/);
await assert.rejects(() => acquireReleaseAssets({ lock, cacheRoot, allowNetwork: false }), /release\.asset_offline_missing/);
```

Also verify a corrupt cache hit is deleted and never returned, temporary `.part` files are removed after failure, redirects remain HTTPS, and progress events expose no credential or local user path.

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/release-asset-acquirer.test.mjs
```

Expected: FAIL because the acquisition module does not exist.

- [x] **Step 3: Implement exact acquisition**

Use Node `fetch`, stream to `<hash>.part`, count bytes, hash while writing, fsync, and atomically rename only after exact size/hash validation. Re-verify every cache hit. `allowNetwork:false` must never call `fetchImpl`.

The maintainer script loads the checked-in lock and writes only a JSON report:

```js
const assets = await acquireReleaseAssets({
  lock: await loadReleaseAssetLock("release/windows-x64-assets.lock.json"),
  cacheRoot: "artifacts/release-cache",
  allowNetwork: true,
});
```

- [x] **Step 4: Run focused tests and a real acquisition**

Run:

```powershell
node --test test/release-asset-acquirer.test.mjs
node scripts/fetch-windows-release-assets.mjs
```

Expected: tests PASS; six real assets are present under `artifacts/release-cache/sha256`; the report records `startsDesktopControl:false` and `includeUserOverlay:false`.

- [x] **Step 5: Commit**

```powershell
git add src/release-asset-acquirer.mjs scripts/fetch-windows-release-assets.mjs test/release-asset-acquirer.test.mjs
git commit -m "feat: acquire locked release assets"
```

### Task 3: Real Portable Windows Payload

**Files:**
- Create: `src/windows-release-payload.mjs`
- Create: `scripts/expand-verified-zip.ps1`
- Create: `test/windows-release-payload.test.mjs`
- Modify: `gateway-overlay/GatewayComputerUseOverlay.csproj`
- Modify: `package.json`

**Interfaces:**
- Consumes: protected npm staging root and acquired Node archive.
- Produces: `buildWindowsReleasePayload({ outputRoot, acquiredAssets, generatedAt }): Promise<WindowsPayloadReport>`.
- `WindowsPayloadReport` exposes `bundleRoot`, `installerPath`, `overlayRoot`, `runtimeDescriptorPath`, file counts, and `distributionStatus`.

- [x] **Step 1: Write failing payload tests**

The test assembles from a small valid Node ZIP fixture and real local .NET builds, then asserts:

```js
assert.equal(report.status, "ready");
assert.equal(report.distributionStatus, "blocked_unsigned");
assert.equal(await exists("payload/runtime/node/node.exe"), true);
assert.equal(await exists("payload/package/dist/launcher.mjs"), true);
assert.equal(await exists("payload/helpers/overlay/GatewayComputerUseOverlay.exe"), true);
assert.equal(await exists("payload/bin/AgentComputerUse.Installer.exe"), true);
assert.equal(report.sourceEntryCount, 0);
assert.equal(report.sourceMapCount, 0);
```

Assert the runtime descriptor uses `runtime/node/node.exe` plus `package/dist/launcher.mjs`, and no path points to the worktree, global npm, or a machine-wide Node installation.

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test test/windows-release-payload.test.mjs
```

Expected: FAIL because the payload builder does not exist.

- [x] **Step 3: Implement safe ZIP extraction and portable dependency staging**

`expand-verified-zip.ps1` first enumerates every ZIP entry, rejects absolute paths, `..`, duplicate case-insensitive paths, links, and output escape, then extracts to a fresh root.

The payload builder performs this exact order:

```text
release:npm:build
copy protected package to staging/package
copy root package.json + package-lock.json to dependency staging
npm ci --omit=dev --ignore-scripts in dependency staging
copy production node_modules to staging/package/node_modules
extract pinned Node ZIP to staging/runtime/node
dotnet publish windows-installer as win-x64 NativeAOT
dotnet publish overlay as win-x64 self-contained output
write runtime-entrypoints.json
materializeReleaseBundle into output/release
```

Update the overlay project/publish command so the GitHub payload does not require a machine-wide .NET runtime. Do not use single-file settings if they break WebView2 native loading; include and inventory every required output instead.

- [x] **Step 4: Run focused tests and real builds**

Run:

```powershell
node --test test/windows-release-payload.test.mjs test/protected-npm-build.test.mjs test/release-bundle.test.mjs
npm run installer:publish:win-x64
dotnet publish gateway-overlay/GatewayComputerUseOverlay.csproj --configuration Release --runtime win-x64 --self-contained true --output artifacts/gateway-overlay/win-x64 --nologo
```

Expected: PASS; generated native output remains ignored.

- [x] **Step 5: Commit**

```powershell
git add src/windows-release-payload.mjs scripts/expand-verified-zip.ps1 test/windows-release-payload.test.mjs gateway-overlay/GatewayComputerUseOverlay.csproj package.json
git commit -m "feat: build portable Windows release payload"
```

### Task 4: Official PP-OCRv6 ONNX Pack And Offline Assets

**Files:**
- Create: `src/ocr-release-model-pack.mjs`
- Create: `src/windows-offline-bundle.mjs`
- Create: `scripts/create-deterministic-zip.ps1`
- Create: `test/ocr-release-model-pack.test.mjs`
- Create: `test/windows-offline-bundle.test.mjs`
- Modify: `src/ocr-model-pack.mjs`

**Interfaces:**
- Produces: `buildPpOcrV6SmallPack({ detPath, recPath, metadataPath, outputRoot }): Promise<ModelPackReport>`.
- Produces: `buildWindowsOfflineBundle({ payload, acquiredAssets, outputRoot, generatedAt, candidateTrust }): Promise<OfflineBundleReport>`.
- Offline output matches `installer/`, `release/`, `assets/blobs/sha256/`, `trust/`, `metadata/`, and `licenses/`.

- [x] **Step 1: Write failing official model-pack tests**

Parse a minimal official `inference.yml` fixture with `yaml.parse`, extract `PostProcess.character_dict`, and assert:

```js
assert.deepEqual(report.files.map((file) => file.name), [
  "PP-OCRv6_det_small.onnx",
  "PP-OCRv6_rec_small.onnx",
  "ppocrv6_dict.txt",
]);
assert.equal(report.dictionaryEntries, 18709);
assert.equal(report.modelFormat, "onnx");
```

Reject absent `CTCLabelDecode`, an empty dictionary, ONNX size/hash mismatch, duplicate dictionary entries only when the official metadata itself is malformed, and output outside the requested root.

- [x] **Step 2: Write failing offline-bundle tests**

Assert deterministic ZIP bytes for two assemblies with the same `generatedAt`, complete required asset IDs, exact content-addressed blob names, candidate trust marked `developmentOnly:true`, and:

```js
assert.equal(report.installable, true);
assert.equal(report.distributionStatus, "blocked_unsigned");
assert.equal(report.firstEnableDownloadCount, 0);
assert.equal(report.includeUserOverlay, false);
```

Assert missing Node, driver, overlay, OCR det/rec/dictionary, ONNX Runtime, installer, or WebView2 blocks assembly instead of degrading.

- [x] **Step 3: Run both tests and verify RED**

Run:

```powershell
node --test test/ocr-release-model-pack.test.mjs test/windows-offline-bundle.test.mjs
```

Expected: FAIL because both modules are absent.

- [x] **Step 4: Implement model and asset assembly**

Rename only after verifying official downloaded bytes. Generate `ppocrv6_dict.txt` as one UTF-8 character per line from official metadata. Update `PP_OCRV6_SMALL_MODEL_PACK` from `pinned-by-release` placeholders to the lock version/hash values supplied by assembly.

Create deterministic per-asset ZIP blobs and a development-only ECDSA manifest through the existing trust helper. Include:

```text
cua-driver-windows-x64
ocr-model-pp-ocrv6-small
webview2-evergreen-standalone-windows-x64
```

The self-contained overlay, Node, and production `onnxruntime-node` stay in the immutable release payload and are represented in the release manifest/SBOM rather than duplicated as activated asset views.

- [x] **Step 5: Run focused tests and commit**

Run:

```powershell
node --test test/ocr-release-model-pack.test.mjs test/windows-offline-bundle.test.mjs test/phase-3-0-ocr-model-pack.test.mjs test/asset-manifest-trust.test.mjs
git add src/ocr-release-model-pack.mjs src/windows-offline-bundle.mjs src/ocr-model-pack.mjs scripts/create-deterministic-zip.ps1 test/ocr-release-model-pack.test.mjs test/windows-offline-bundle.test.mjs
git commit -m "feat: assemble real offline Windows assets"
```

### Task 5: CycloneDX SBOM, Release Manifest, And Checksums

**Files:**
- Create: `src/release-sbom.mjs`
- Create: `src/release-output-manifest.mjs`
- Create: `test/release-sbom.test.mjs`
- Create: `test/release-output-manifest.test.mjs`

**Interfaces:**
- Produces: `buildReleaseSbom({ outputPath, lock, payloadReport }): Promise<SbomReport>`.
- Produces: `writeReleaseOutputManifest({ identity, artifacts, outputRoot }): Promise<ReleaseOutputReport>`.
- The manifest artifacts contain `{ id, fileName, mediaType, sizeBytes, sha256, distributionStatus }`.

- [ ] **Step 1: Write failing SBOM tests**

Assert CycloneDX format, root package identity, locked components, production npm dependencies, hashes, licenses, and no local path, username, screenshot, OCR text, private key, signature secret, or overlay pixel fields.

Required component IDs:

```text
agent-computer-use-mcp
node-runtime-windows-x64
cua-driver-windows-x64
gateway-overlay-windows-x64
onnxruntime-node
ocr-model-pp-ocrv6-small-det
ocr-model-pp-ocrv6-small-rec
webview2-evergreen-standalone-windows-x64
```

- [ ] **Step 2: Write failing manifest/checksum tests**

Assert sorted artifact names, exact bytes/hashes, LF line endings, no absolute paths, and checksum lines in this form:

```text
<lowercase-sha256>  <file-name>
```

Tampering any artifact after manifest generation must make `verifyReleaseOutputs` fail with `release.output_hash_mismatch`.

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node --test test/release-sbom.test.mjs test/release-output-manifest.test.mjs
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement SBOM and output evidence**

Run npm's built-in command from the locked source workspace:

```powershell
npm sbom --omit dev --sbom-format cyclonedx --sbom-type application
```

Parse the JSON, add deterministic external/native components from the lock and payload report, sort by `bom-ref`, and write without local paths. Hash only finalized files. `checksums.txt` includes every published candidate output except itself.

- [ ] **Step 5: Run focused tests and commit**

```powershell
node --test test/release-sbom.test.mjs test/release-output-manifest.test.mjs
git add src/release-sbom.mjs src/release-output-manifest.mjs test/release-sbom.test.mjs test/release-output-manifest.test.mjs
git commit -m "feat: emit release SBOM and checksums"
```

### Task 6: End-To-End Real Candidate Assembly And Offline Install Smoke

**Files:**
- Create: `src/windows-release-assembly.mjs`
- Create: `scripts/build-windows-release-candidate.mjs`
- Create: `src/phase-0-15-real-release-assembly.mjs`
- Create: `test/windows-release-assembly.test.mjs`
- Create: `test/phase-0-15-real-release-assembly.test.mjs`
- Modify: `package.json`
- Modify: `src/release-metadata.mjs`
- Modify: `src/release-readiness-gate.mjs`
- Modify: `src/computer-use-provider-router.mjs`

**Interfaces:**
- Produces: `assembleWindowsReleaseCandidate({ outputRoot, cacheRoot, allowNetwork, generatedAt }): Promise<AssemblyReport>`.
- Produces scripts `release:windows:assets`, `release:windows:assemble`, and `phase:0.15`.

- [ ] **Step 1: Write failing orchestration tests**

Use acquired local fixture blobs and injected builders to assert ordered execution, atomic output promotion, cleanup after any stage failure, and no output when a required asset is corrupt. Assert a successful report exposes:

```js
assert.equal(report.status, "passed");
assert.equal(report.platform, "windows-x64");
assert.equal(report.installable, true);
assert.equal(report.distributionStatus, "blocked_unsigned");
assert.equal(report.assetCount, 6);
assert.equal(report.firstEnableDownloadCount, 0);
assert.equal(report.startsDesktopControl, false);
assert.equal(report.includeUserOverlay, false);
```

- [ ] **Step 2: Write the failing executable Phase 0.15 test**

Assert the package script exists and the phase report proves:

```js
assert.equal(report.realAssetBytesVerified, true);
assert.equal(report.releaseBundleVerified, true);
assert.equal(report.offlineBundleVerified, true);
assert.equal(report.installerAppliedRelease, true);
assert.equal(report.assetsPreparedAndActivatedOffline, true);
assert.equal(report.standardMcpSmokePassed, true);
assert.equal(report.ocrModelPackPresent, true);
assert.equal(report.webView2InstallerPresent, true);
assert.equal(report.checksumsVerified, true);
assert.equal(report.sbomVerified, true);
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```powershell
node --test test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs
```

Expected: FAIL because orchestration and Phase 0.15 are absent.

- [ ] **Step 4: Implement atomic assembly**

Assemble under `<output>.staging-<uuid>`, verify every output, remove any previous candidate output, and atomically rename only after all stages pass. The candidate command uses the real checked-in asset lock and defaults to network acquisition during assembly.

The phase gate then creates temporary program/data roots and, with network disabled:

1. installs the assembled release bundle through `AgentComputerUse.Installer.exe install`;
2. prepares and activates all asset views from the offline bundle through the native installer;
3. launches the installed portable Node plus protected launcher;
4. connects with the official MCP SDK;
5. initializes, lists tools, and calls `computer.health({fast:true})`;
6. confirms active driver, overlay, model pack, WebView2 installer, hashes, and runtime entrypoints resolve inside temporary installed roots;
7. closes the client and removes all temporary roots.

- [ ] **Step 5: Run focused tests and the real candidate gate**

Run:

```powershell
node --test test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs
npm run release:windows:assemble
npm run phase:0.15
```

Expected: all commands exit `0`; the real candidate is built from six locked upstream assets; the offline install phase performs no network calls.

- [ ] **Step 6: Commit**

```powershell
git add src/windows-release-assembly.mjs scripts/build-windows-release-candidate.mjs src/phase-0-15-real-release-assembly.mjs test/windows-release-assembly.test.mjs test/phase-0-15-real-release-assembly.test.mjs package.json src/release-metadata.mjs src/release-readiness-gate.mjs src/computer-use-provider-router.mjs
git commit -m "feat: prove real Windows release assembly"
```

### Task 7: CI, Release Gates, And Operator Documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/README.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `CHANGELOG.md`
- Test: `test/phase-0-11-release-readiness.test.mjs`
- Test: `test/phase-0-15-real-release-assembly.test.mjs`

**Interfaces:**
- CI invokes `npm run phase:0.15` on `windows-latest` after Phase 7.9.
- Roadmap records PR4 as real candidate assembly, not formal distribution.

- [ ] **Step 1: Add failing governance assertions**

Assert Phase 0.15 is required release evidence, CI runs it, docs name every candidate artifact, and docs state that unsigned PR4 outputs are distribution-blocked until PR5.

- [ ] **Step 2: Run and verify RED**

Run:

```powershell
node --test test/phase-0-11-release-readiness.test.mjs test/phase-0-15-real-release-assembly.test.mjs
```

Expected: FAIL because CI and release documentation do not reference Phase 0.15.

- [ ] **Step 3: Update CI and documentation**

Add a Windows CI step:

```yaml
- name: Assemble and install real Windows release candidate
  run: npm run phase:0.15
```

Document artifact locations under `artifacts/windows-release/<version>/`, the six locked external assets, expected candidate size, offline/no-Node behavior, and the `blocked_unsigned` boundary before PR5.

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm test
npm run phase:0.14
npm run phase:7.8
npm run phase:7.9
npm run phase:0.15
npm audit --omit=dev
git diff --check
git status --short
```

Expected: all tests and phases pass; production dependency audit reports zero vulnerabilities; only intended tracked files are modified; generated artifacts stay ignored.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/ci.yml docs/productization/roadmap.md docs/productization/release-gates.md docs/productization/README.md README.md CONTRIBUTING.md CHANGELOG.md test/phase-0-11-release-readiness.test.mjs test/phase-0-15-real-release-assembly.test.mjs
git commit -m "docs: gate real Windows release assembly"
```

## Final PR4 Review Gate

Before opening PR4:

```powershell
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
npm test
npm run phase:0.15
```

Review must explicitly confirm:

- real locked bytes were acquired and hashed;
- official PaddlePaddle PP-OCRv6 small ONNX models, not ppu `.ort` defaults, are in the candidate;
- the installed MCP process uses portable Node and protected `dist` only;
- the offline install smoke ran with no network and no preinstalled Node dependency;
- candidate Authenticode remains unsigned and distribution-blocked;
- no development key, generated binary, model, cache, or local path is committed;
- overlay exclusion remains intact;
- PR5 remains responsible for production signing, draft GitHub Release, npm OIDC/provenance, and post-publish smoke.
