# Asset Cache Materializer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real, approval-gated, offline-capable Windows asset acquisition, verification, content-addressed cache, installation, and rollback pipeline for `agent-computer-use-mcp`.

**Architecture:** The .NET 10 NativeAOT installer remains the only writer of installation and asset activation state. It verifies detached ECDSA P-256 manifests, acquires release-pinned blobs from offline roots or resumable HTTPS, safely materializes immutable assets, validates Windows trust policy, and atomically activates or rolls back asset state. The Node MCP layer manages approval, asynchronous operation lifecycle, progress, cancellation, timeout, and standard MCP output.

**Tech Stack:** Node.js 20 ESM, Node test runner, official `@modelcontextprotocol/sdk`, .NET 10, `HttpClient`, `System.IO.Compression`, `System.Security.Cryptography`, WinTrust P/Invoke, GitHub Actions Windows runners.

## Global Constraints

- Production manifests use schema version `2` and detached ECDSA P-256 SHA-256 signatures over exact UTF-8 manifest bytes.
- Private signing keys never enter source, npm packages, test output, logs, traces, or generated release artifacts.
- First-party Windows executables require valid manifest signature, exact hashes, WinTrust verification, timestamp evidence, and an allowed publisher.
- Upstream unsigned `cua-driver` is accepted only under explicit `vendor-unsigned` policy plus signed manifest, exact official archive SHA-256, release identity, and extracted-file hashes.
- Offline source is attempted first. Network requires explicit approval and `allowNetwork=true`.
- Manifest, signature, keyring, offline bundle, program, and data roots are host-owned configuration and are never accepted from public MCP input.
- HTTP sources must be HTTPS in production. Private-network HTTP is dependency-injected only in tests with a development-only manifest.
- Blobs and materialized asset versions are immutable and content-addressed.
- Any verification, download, extraction, materialization, or activation failure leaves current asset state unchanged.
- First enable never downloads, installs, starts desktop control, starts the overlay, or captures a screen.
- Every operation and test result reports `startsDesktopControl=false` and `includeUserOverlay=false`.
- Generated downloads, manifests, keys, model files, helpers, installer outputs, and caches remain under ignored roots.
- `AGENT_COMPUTER_USE_*` is the public environment prefix; `XIAOZHICLAW_*` remains compatibility-only.

---

### Task 1: Detached Asset Manifest Trust

**Files:**

- Create: `windows-installer/AssetModels.cs`
- Create: `windows-installer/AssetManifestVerifier.cs`
- Modify: `windows-installer/InstallerJsonContext.cs`
- Modify: `windows-installer/InstallerModels.cs`
- Modify: `windows-installer/Program.cs`
- Modify: `src/windows-installer-host.mjs`
- Create: `test/helpers/asset-fixture.mjs`
- Create: `test/asset-manifest-trust.test.mjs`

**Interfaces:**

- CLI: `asset-verify-manifest --manifest <path> --signature <path> --trust-keyring <path> --program-root <path> --data-root <path>`
- Signature envelope: `{ schemaVersion: 1, algorithm: "ecdsa-p256-sha256", keyId, signature }`
- Keyring: `{ schemaVersion: 1, keys: [{ keyId, algorithm, publicKeyPem, status: "trusted" }] }`
- Terminal result: `{ status, operation, releaseId, manifestSha256, assetCount, startsDesktopControl:false, includeUserOverlay:false }`
- Test helper: `createSignedAssetFixture({ root, assets, developmentOnly, expiresAt })`

- [x] **Step 1: Write failing signature and mutation tests**

```js
test("native installer verifies exact signed asset manifest bytes", async () => {
  const fixture = await createSignedAssetFixture({ root, assets: [driverAsset()] });
  const result = await runWindowsInstaller("asset-verify-manifest", fixture.paths);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.report.status, "verified");
  assert.equal(result.report.releaseId, fixture.manifest.releaseId);
  assert.match(result.report.manifestSha256, /^[a-f0-9]{64}$/);
});

test("native installer rejects a manifest changed after signing", async () => {
  const fixture = await createSignedAssetFixture({ root, assets: [driverAsset()] });
  await writeFile(fixture.manifestPath, `${await readFile(fixture.manifestPath, "utf8")} `);
  const result = await runWindowsInstaller("asset-verify-manifest", fixture.paths);
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.error.code, "asset.manifest_signature_invalid");
});
```

Add separate failures for unknown key ID, expired manifest, duplicate asset IDs, invalid hash/size, unsupported platform, credential-bearing URL, non-HTTPS production URL, and `vendor-unsigned` without exact upstream provenance.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/asset-manifest-trust.test.mjs`

Expected: FAIL because `asset-verify-manifest` is not a supported installer operation.

- [x] **Step 3: Implement models and exact-byte signature verification**

```csharp
internal sealed class AssetManifestVerifier
{
    public VerifiedAssetManifest Verify(string manifestPath, string signaturePath, string keyringPath)
    {
        var bytes = File.ReadAllBytes(manifestPath);
        var envelope = ReadSignature(signaturePath);
        var key = ReadKeyring(keyringPath).Keys.SingleOrDefault(item => item.KeyId == envelope.KeyId)
            ?? throw new InstallerException("asset.manifest_key_unknown", "Manifest key is not trusted");
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(key.PublicKeyPem);
        if (!ecdsa.VerifyData(bytes, Convert.FromBase64String(envelope.Signature), HashAlgorithmName.SHA256))
            throw new InstallerException("asset.manifest_signature_invalid", "Manifest signature is invalid");
        var manifest = JsonSerializer.Deserialize(bytes, InstallerJsonContext.Default.AssetManifest)
            ?? throw new InstallerException("asset.manifest_invalid", "Asset manifest is empty");
        ValidateManifest(manifest);
        return new VerifiedAssetManifest(manifest, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
    }
}
```

Validation must implement every fail-closed condition asserted by Step 1. The installer `Main` becomes `async Task<int>` without changing existing release operation output.

- [x] **Step 4: Extend the Node host for structured asset commands**

`runWindowsInstaller` accepts manifest, signature, keyring, offline root, asset IDs, network permission, operation ID, and environment overrides. It parses one JSON terminal line for existing commands and the final NDJSON record for asset commands.

- [x] **Step 5: Run focused and existing installer tests**

Run: `node --test test/asset-manifest-trust.test.mjs test/windows-installer-transaction.test.mjs`

Expected: PASS with existing install/upgrade/rollback behavior unchanged.

- [x] **Step 6: Commit Task 1**

```sh
git add windows-installer src/windows-installer-host.mjs test/helpers/asset-fixture.mjs test/asset-manifest-trust.test.mjs
git commit -m "feat: verify signed asset manifests"
```

### Task 2: Offline Content-Addressed Cache And Safe Materialization

**Files:**

- Create: `windows-installer/AssetCache.cs`
- Create: `windows-installer/SafeZipMaterializer.cs`
- Create: `windows-installer/AssetStateStore.cs`
- Create: `windows-installer/AssetEngine.cs`
- Create: `windows-installer/AssetProgressWriter.cs`
- Modify: `windows-installer/InstallerLayout.cs`
- Modify: `windows-installer/Program.cs`
- Modify: `src/ocr-model-pack.mjs`
- Modify: `test/phase-3-0-ocr-model-pack.test.mjs`
- Create: `test/asset-cache-materializer.test.mjs`

**Interfaces:**

- Offline blob path: `<offline-root>/blobs/sha256/<sha256>`
- CAS blob path: `<program-root>/cache/assets/sha256/<first-two>/<sha256>/blob`
- Materialized path: `<program-root>/assets/<asset-id>/<version>/<blob-sha256>/`
- CLI: `asset-prepare ... --asset-ids <comma-separated> --offline-root <path>`
- CLI: `asset-activate --release-id <id> ...`
- CLI: `asset-status ...`
- CLI: `asset-rollback ...`
- State: `{ schemaVersion:1, currentReleaseId, previousReleaseId, revision, activatedAt, assets:[{ id, version, blobSha256, root, entryPoint }] }`

- [x] **Step 1: Write failing offline materialization and rollback tests**

```js
test("offline prepare activate and rollback use immutable content-addressed assets", async () => {
  const v1 = await createSignedAssetFixture({ root, assets: [await zippedDriverAsset("0.7.1")] });
  const v2 = await createSignedAssetFixture({ root, releaseId: "0.0.2-windows-x64", assets: [await zippedDriverAsset("0.7.2")] });
  assert.equal((await runAsset("asset-prepare", v1)).report.status, "prepared");
  assert.equal((await runAsset("asset-activate", { ...v1, releaseId: v1.manifest.releaseId })).report.currentReleaseId, v1.manifest.releaseId);
  await runAsset("asset-prepare", v2);
  await runAsset("asset-activate", { ...v2, releaseId: v2.manifest.releaseId });
  const rolledBack = await runAsset("asset-rollback", v2);
  assert.equal(rolledBack.report.currentReleaseId, v1.manifest.releaseId);
  assert.equal(rolledBack.report.previousReleaseId, v2.manifest.releaseId);
});
```

Add failures for corrupt offline blob, hash collision/version conflict, ZIP traversal, duplicate case-insensitive path, undeclared archive file, expanded-size overflow, raw-file mismatch, and corrupted previous state. Assert active state and immutable directories are unchanged after each failure.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/asset-cache-materializer.test.mjs`

Expected: FAIL because asset prepare/activate/status/rollback are absent.

- [x] **Step 3: Implement cache promotion and safe extraction**

```csharp
public async Task<CachedBlob> ImportOfflineAsync(AssetEntry asset, string offlineRoot, CancellationToken cancellationToken)
{
    var source = ResolveInside(offlineRoot, Path.Combine("blobs", "sha256", asset.Source.Sha256));
    await VerifyFileAsync(source, asset.Source.SizeBytes, asset.Source.Sha256, cancellationToken);
    var target = layout.GetAssetBlobPath(asset.Source.Sha256);
    await PromoteVerifiedFileAsync(source, target, copy: true, cancellationToken);
    return new CachedBlob(target, asset.Source.Sha256, asset.Source.SizeBytes);
}
```

`SafeZipMaterializer` enumerates the archive before extraction, normalizes every path, rejects links/reparse metadata, requires exact manifest membership, maps each archive `path` to its explicit `installPath`, streams each file with size limits, and verifies hashes before transaction promotion.

- [x] **Step 4: Implement immutable state transitions**

Prepare all selected assets in a transaction root, verify preflight entry points, atomically promote version directories, and write a prepared state file. Activate only a complete prepared release. Rollback re-verifies the previous manifest hash and every immutable asset before swapping state.

- [x] **Step 5: Align the OCR pack with the native sidecar**

```js
export const PP_OCRV6_SMALL_MODEL_PACK = {
  files: [
    { role: "det", path: "PP-OCRv6_det_small.onnx", required: true },
    { role: "rec", path: "PP-OCRv6_rec_small.onnx", required: true },
    { role: "dictionary", path: "ppocrv6_dict.txt", required: true },
  ],
};
```

Update tests and doctor repair details to use the actual sidecar filenames. Do not introduce a required `cls.onnx`.

- [x] **Step 6: Run focused and regression tests**

Run: `node --test test/asset-cache-materializer.test.mjs test/phase-3-0-ocr-model-pack.test.mjs test/install-cache-doctor.test.mjs test/windows-installer-transaction.test.mjs`

Expected: PASS.

- [x] **Step 7: Commit Task 2**

```sh
git add windows-installer src/ocr-model-pack.mjs test/asset-cache-materializer.test.mjs test/phase-3-0-ocr-model-pack.test.mjs test/install-cache-doctor.test.mjs
git commit -m "feat: materialize immutable offline assets"
```

### Task 3: Resumable HTTPS Acquisition

**Files:**

- Create: `windows-installer/AssetDownloader.cs`
- Create: `windows-installer/AssetSourcePolicy.cs`
- Modify: `windows-installer/AssetEngine.cs`
- Modify: `windows-installer/AssetModels.cs`
- Create: `test/asset-download-resume.test.mjs`

**Interfaces:**

- Partial: `<cache-downloads>/<sha256>.partial`
- Resume metadata: `<cache-downloads>/<sha256>.resume.json`
- Resume metadata: `{ schemaVersion:1, sourceUrl, expectedSha256, expectedSizeBytes, etag, lastModified, downloadedBytes }`
- Production network policy: HTTPS, maximum five redirects, no downgrade, no credentials, no private/loopback/link-local destination, bounded size and timeouts.

- [x] **Step 1: Write a failing real HTTP resume test**

```js
test("asset download resumes an interrupted transfer with Range and ETag", async () => {
  const server = await createInterruptingAssetServer(blob, { etag: '"fixture-v1"' });
  const first = await runPrepare({ fixture, allowNetwork: true, env: testPrivateNetworkEnv });
  assert.equal(first.report.error.code, "asset.download_interrupted");
  const second = await runPrepare({ fixture, allowNetwork: true, env: testPrivateNetworkEnv });
  assert.equal(second.report.status, "prepared");
  assert.equal(server.requests.some((request) => request.headers.range?.startsWith("bytes=")), true);
  assert.equal(await sha256(cachedBlobPath), fixture.asset.source.sha256);
});
```

Add tests for network disabled, offline-first cache hit, changed ETag restart, ignored Range restart, redirect downgrade rejection, oversize response, wrong hash, idle timeout, and cancellation preserving only valid partial metadata.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/asset-download-resume.test.mjs`

Expected: FAIL because network acquisition is not implemented.

- [x] **Step 3: Implement bounded resumable streaming**

```csharp
using var request = new HttpRequestMessage(HttpMethod.Get, sourceUri);
if (resume.DownloadedBytes > 0)
{
    request.Headers.Range = new RangeHeaderValue(resume.DownloadedBytes, null);
    request.Headers.IfRange = new RangeConditionHeaderValue(resume.ETag);
}
using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
var append = response.StatusCode == HttpStatusCode.PartialContent && ResumeMatches(response, resume);
if (!append) ResetPartial(partialPath, resumePath);
await StreamBoundedAsync(response, partialPath, append, asset.Source.SizeBytes, progress, cancellationToken);
await VerifyAndPromoteAsync(partialPath, asset, cancellationToken);
```

Resolve and validate every redirect target. Use separate connect, idle, and total cancellation tokens. Persist resume metadata atomically after each bounded progress interval.

- [x] **Step 4: Run focused and offline regression tests**

Run: `node --test test/asset-download-resume.test.mjs test/asset-cache-materializer.test.mjs`

Expected: PASS without external network access.

- [x] **Step 5: Commit Task 3**

```sh
git add windows-installer test/asset-download-resume.test.mjs
git commit -m "feat: add resumable asset acquisition"
```

### Task 4: Windows Trust Policy And Real Cua Driver Proof

**Files:**

- Create: `windows-installer/AuthenticodeVerifier.cs`
- Modify: `windows-installer/AssetEngine.cs`
- Modify: `src/package-foundation.mjs`
- Modify: `test/package-foundation.test.mjs`
- Create: `src/cua-driver-live-asset.mjs`
- Create: `scripts/live-cua-driver-asset.mjs`
- Create: `test/asset-windows-trust.test.mjs`
- Create: `test/cua-driver-live-asset.test.mjs`
- Modify: `package.json`

**Interfaces:**

- `AuthenticodeVerifier.Verify(path, policy)` returns `{ status, publisher, timestamped, mode }` or throws a stable `asset.authenticode_*` code.
- Live command: `npm run assets:live:cua-driver`
- Live result: `{ status:"passed"|"skipped_environment"|"failed", version, archiveSha256, executableSha256, executableVersion, temporaryRootsCleaned, startsDesktopControl:false, includeUserOverlay:false }`

- [x] **Step 1: Write failing policy tests**

```js
test("vendor unsigned cua-driver requires exact upstream release provenance", async () => {
  const accepted = await prepareOfficialDriverFixture({ authenticode: { mode: "vendor-unsigned" } });
  assert.equal(accepted.report.status, "prepared");
  const rejected = await prepareOfficialDriverFixture({ provenance: { upstreamSha256: sha256("wrong") } });
  assert.equal(rejected.report.error.code, "asset.vendor_provenance_mismatch");
});

test("unsigned first-party helper is never distributable", async () => {
  const result = await prepareUnsignedOverlayFixture();
  assert.equal(result.report.error.code, "asset.authenticode_required");
});
```

On Windows, add a positive Microsoft-signed system-file fixture for publisher/WinTrust verification and a publisher mismatch case. Release-policy tests assert only first-party helpers and Microsoft system installers require Authenticode; third-party unsigned driver requires signed provenance instead.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/asset-windows-trust.test.mjs test/package-foundation.test.mjs`

Expected: FAIL because Authenticode and vendor provenance policies are not executable.

- [x] **Step 3: Implement WinTrust and timestamp inspection**

Use `WinVerifyTrust` with `WTD_STATEACTION_VERIFY`, then inspect provider signer state through `WTHelperProvDataFromStateData` and `WTHelperGetProvSignerFromChain`. Copy the signer certificate bytes from `CERT_CONTEXT` into `X509Certificate2`, compare normalized publisher identity, and require at least one counter-signer when `timestampRequired=true`. Always close WinTrust state in `finally`.

- [x] **Step 4: Implement the real upstream live runner**

The runner builds a development signed manifest around the exact official release values from the spec, downloads into temporary program/data roots, prepares and activates there, executes `cua-driver.exe --version`, validates `cua-driver 0.7.1`, and removes all temporary roots in `finally`. Only transport/DNS/TLS unavailability maps to `skipped_environment`; any trust, hash, archive, or version mismatch is `failed`.

- [x] **Step 5: Run policy tests and live proof**

Run: `node --test test/asset-windows-trust.test.mjs test/cua-driver-live-asset.test.mjs test/package-foundation.test.mjs`

Expected: PASS.

Run: `npm run assets:live:cua-driver`

Expected on a connected Windows host: `status=passed`, archive SHA `00dfa76c...fc5aab`, executable SHA `6ee5565a...54f7`, version `0.7.1`, and temporary roots cleaned.

- [x] **Step 6: Commit Task 4**

```sh
git add windows-installer src/package-foundation.mjs src/cua-driver-live-asset.mjs scripts/live-cua-driver-asset.mjs test package.json
git commit -m "feat: enforce Windows asset trust"
```

### Task 5: Approval-Gated MCP Asset Operations

**Files:**

- Create: `src/asset-installer-host.mjs`
- Create: `src/asset-operation-manager.mjs`
- Create: `test/asset-operation-manager.test.mjs`
- Modify: `src/computer-use-provider-router.mjs`
- Modify: `src/computer-use-mcp-tools.mjs`
- Modify: `src/repair-progress-plan.mjs`
- Modify: `test/phase-2-1-repair.test.mjs`
- Create: `test/asset-repair-mcp.test.mjs`

**Interfaces:**

- `new AssetOperationManager({ executor, stateRoot, clock })`
- Internal host call: `start({ operationId, actionIds, allowNetwork, timeoutMs, ...fixedHostAssetConfig })`
- `status(operationId)`
- `cancel(operationId, reason)`
- Optional public `computer.repair` inputs: `operation`, `operationId`, `requestApproval`, `approvalToken`, `approvalTtlMs`, `allowNetwork`, `timeoutMs`.
- Public input MUST NOT expose `manifestPath`, `signaturePath`, `keyringPath`, `offlineRoot`, `programRoot`, or `dataRoot`; accepting those would let an agent replace the trust root.

- [x] **Step 1: Write failing operation-manager tests**

```js
test("approved asset repair starts reports progress and completes", async () => {
  const manager = new AssetOperationManager({ executor: fixtureExecutor, stateRoot });
  const started = await manager.start({ operationId: "asset-op-1", actionIds: ["install-cua-driver-windows-x64"], allowNetwork: false });
  assert.equal(started.status, "running");
  assert.equal((await manager.status("asset-op-1")).events.at(-1).state, "complete");
});

test("asset repair cancellation terminates execution and preserves resumable state", async () => {
  const manager = new AssetOperationManager({ executor: blockingExecutor, stateRoot });
  await manager.start({ operationId: "asset-op-2", actionIds: ["cache-ocr-model-pp-ocrv6-small"] });
  const cancelled = await manager.cancel("asset-op-2", "user-requested");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.events.at(-1).terminal, true);
});
```

Add idempotent duplicate start, single activation lock, unknown operation, timeout, disconnect/shutdown cancellation, path redaction, no network without approved `allowNetwork`, and state reload after manager restart.

- [x] **Step 2: Run manager tests and verify RED**

Run: `node --test test/asset-operation-manager.test.mjs`

Expected: FAIL because the manager does not exist.

- [x] **Step 3: Implement persisted managed execution**

The host spawns the single-process native helper with argument arrays and `shell:false`, parses NDJSON progress plus its terminal record, writes redacted operation snapshots atomically, bounds retained events, enforces timeout and cancellation with `AbortController`, and releases the activation lock in `finally`.

- [x] **Step 4: Write failing standard MCP repair tests**

Use the official MCP SDK client. Request an approval token, start an offline asset repair with `dryRun:false`, poll `computer.repair({ operation:"status" })`, and cancel a second operation. Assert no action runs without approval and no operation enables Computer Use.

- [x] **Step 5: Extend repair schema and router compatibly**

`operation` defaults to `plan`. `start` requires valid approval, selected action IDs, host-fixed asset delivery configuration, and `dryRun:false`. The approval binds the exact action set and network permission. `status` and `cancel` never request new approval. Existing process-restart and runtime-cleanup execution remains unchanged.

- [x] **Step 6: Run focused and MCP contract tests**

Run: `node --test test/asset-operation-manager.test.mjs test/asset-repair-mcp.test.mjs test/phase-2-1-repair.test.mjs test/phase-5-3-tool-output-schemas.test.mjs test/phase-5-7-public-contract-review.test.mjs`

Expected: PASS with unchanged tool names and strict schemas.

- [x] **Step 7: Commit Task 5**

```sh
git add src/asset-installer-host.mjs src/asset-operation-manager.mjs src/computer-use-provider-router.mjs src/computer-use-mcp-tools.mjs src/repair-progress-plan.mjs test
git commit -m "feat: execute approved asset repairs"
```

### Task 6: Phase 7.9, CI, Release Gates, And Documentation

**Files:**

- Create: `src/phase-7-9-asset-cache-materializer.mjs`
- Create: `test/phase-7-9-asset-cache-materializer.test.mjs`
- Modify: `package.json`
- Modify: `src/computer-use-provider-router.mjs`
- Modify: `src/release-readiness-gate.mjs`
- Modify: `src/release-metadata.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/productization/README.md`
- Modify: `docs/productization/roadmap.md`
- Modify: `docs/productization/release-gates.md`
- Modify: `docs/productization/public-mcp-contract-review.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `AGENTS.md`
- Modify: `.github/pull_request_template.md`

**Interfaces:**

- Script: `npm run phase:7.9`
- Report: `{ status:"passed", phase:"7.9", manifestVerified, offlineCacheKeyMatchesHttp, resumeUsed, corruptBlobRejected, zipTraversalRejected, activationAtomic, rollbackVerified, mcpRepairVerified, firstEnableDownloadCount:0, startsDesktopControl:false, includeUserOverlay:false }`

- [ ] **Step 1: Write the failing Phase 7.9 contract test**

```js
test("Phase 7.9 proves real asset acquisition cache activation and rollback", async () => {
  assert.equal(packageJson.scripts["phase:7.9"], "node src/phase-7-9-asset-cache-materializer.mjs");
  const result = await runNode(["src/phase-7-9-asset-cache-materializer.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.manifestVerified, true);
  assert.equal(report.offlineCacheKeyMatchesHttp, true);
  assert.equal(report.resumeUsed, true);
  assert.equal(report.activationAtomic, true);
  assert.equal(report.rollbackVerified, true);
  assert.equal(report.firstEnableDownloadCount, 0);
  assert.equal(report.startsDesktopControl, false);
  assert.equal(report.includeUserOverlay, false);
});
```

- [ ] **Step 2: Run the phase test and verify RED**

Run: `node --test test/phase-7-9-asset-cache-materializer.test.mjs`

Expected: FAIL because Phase 7.9 is not registered.

- [ ] **Step 3: Implement the deterministic phase runner**

Use temporary roots, generated fixture ECDSA keys, a local interrupting HTTP server, real ZIP files, the real NativeAOT helper, and the official MCP SDK. Clean every temporary root and stop every child/server in `finally`. Print exactly one final JSON object to stdout.

- [ ] **Step 4: Register release evidence and update governance**

Add `phase:7.9` to alpha commands, required evidence, release metadata, provider health phases, and Windows CI after Phase 7.8. Document the trust distinction between first-party Authenticode and upstream unsigned provenance, operation lifecycle, cache layout, offline flow, and live gate.

- [ ] **Step 5: Run final verification**

Run: `npm run phase:7.9`

Run: `npm run assets:live:cua-driver`

Run: `npm run phase:7.8`

Run: `npm run phase:7.5`

Run: `npm run phase:1.6`

Run: `npm run phase:1.7`

Run: `npm run phase:1.8`

Run: `npm run phase:0.14`

Run: `npm run package:dry-run`

Run: `npm test`

Run: `npm audit --omit=dev`

Run: `npm audit`

Run: `git diff --check`

Expected: every deterministic command exits `0`; the connected-host live gate passes or reports only a transport-level `skipped_environment`; generated assets remain ignored; source/maps remain excluded from npm; no real user install root is modified.

- [ ] **Step 6: Commit Task 6**

```sh
git add .github AGENTS.md CHANGELOG.md README.md docs/productization package.json src test
git commit -m "docs: gate trusted asset delivery"
```

## Pull Request Completion

After all six tasks pass:

1. Re-run every final verification command from Task 6 on the completed branch.
2. Review the diff for secrets, generated keys, downloaded blobs, local paths, model files, binaries, and source-map leakage.
3. Push `feat/asset-cache-materializer`.
4. Open one focused PR describing trust policy, public contract additions, real asset evidence, package impact, and rollback behavior.
5. Obtain independent reviewer approval.
6. Wait for GitHub CI success.
7. Squash merge and delete local and remote feature branches/worktree.
