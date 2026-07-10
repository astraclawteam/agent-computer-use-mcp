# Asset Cache Materializer Specification

Status: approved for PR3 implementation

Date: 2026-07-10

## Objective

PR3 turns the current plan-only asset gates into a real, offline-capable asset acquisition and installation layer for `agent-computer-use-mcp`.

The layer must download or import release-pinned assets, verify provenance and integrity, store immutable content-addressed blobs, materialize versioned assets, activate them atomically, and retain the previous asset state for rollback. It must never download during first enable and must never start desktop control or the user overlay.

## Scope

The implementation covers these product assets:

1. `cua-driver` Windows x64 and arm64 release archives.
2. The first-party Gateway overlay shell.
3. The platform-specific OCR runtime payload used by the protected npm release.
4. The PP-OCRv6 small ONNX model pack.
5. The Microsoft WebView2 Evergreen Standalone Installer when WebView2 is absent.

The initial live proof uses the official `cua-driver-rs-v0.7.1` Windows x64 GitHub Release asset. The official release publishes SHA-256 checksums, including:

- `cua-driver-rs-0.7.1-windows-x86_64.zip`: `00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab`
- `cua-driver-rs-0.7.1-windows-arm64.zip`: `43601a32a1ce9eec5fbbe98803718ad2ca3a3450c499b354b05fedc3a1cc5526`

The installed upstream `cua-driver.exe` is not Authenticode-signed. That fact is represented explicitly in policy and is not treated as a verification failure when every required third-party trust check succeeds.

## Non-Goals

- PR3 does not create the end-user installer wizard.
- PR3 does not provision the production signing private key or code-signing certificate. Release CI integration is owned by the release-pipeline PR.
- PR3 does not publish release assets to GitHub Releases.
- PR3 does not redesign OCR inference or benchmark accuracy. It only delivers the exact model files consumed by the native sidecar.
- PR3 does not start Computer Use, capture a screen, or render the overlay.
- PR3 does not call upstream one-line installation scripts.

## Architectural Decision

The existing .NET NativeAOT installer remains the only component allowed to write installation and asset activation state. It gains asset-manifest verification, resumable acquisition, content-addressed caching, safe archive materialization, asset activation, status, and rollback commands.

The Node MCP process owns user approval, operation lifecycle, progress reporting, cancellation, timeout, and host-facing structured results. It delegates privileged filesystem and Windows trust work to the installer helper and never directly writes active asset directories.

The asset manifest path, detached signature path, trusted public-key keyring, offline bundle root, program root, and data root are host-owned installation configuration. They are resolved once when the MCP server starts from the installed product layout and `AGENT_COMPUTER_USE_*` environment configuration. They are never accepted in public MCP tool input. An agent may select advertised repair actions and request approved network use, but it cannot replace the manifest, signature, keyring, or filesystem roots. This prevents an agent from introducing its own key and self-signing an untrusted payload.

Upstream package managers and install scripts are not execution dependencies. They may be used by release engineering to discover source artifacts, but clients consume only a release-pinned signed manifest.

## Trust Model

### Signed Manifest

Every production asset set consists of two exact files:

- `asset-manifest.json`
- `asset-manifest.sig`

The detached signature covers the exact UTF-8 bytes of `asset-manifest.json`. The algorithm is ECDSA P-256 with SHA-256. The manifest names a `keyId`; the verifier resolves that ID from a built-in public keyring or an explicitly configured enterprise keyring. Private keys never appear in the repository, npm package, logs, traces, or artifacts.

The verifier rejects:

- unknown key IDs or algorithms;
- invalid signatures;
- duplicate asset IDs;
- unsupported schema versions;
- expired manifests;
- package or release mismatches;
- unsupported platform or architecture entries;
- HTTP sources, credential-bearing URLs, fragments, loopback/private-network URLs, or redirect downgrades;
- invalid hashes, sizes, paths, or verification policies.

Private-network HTTP is available only through an explicit test-only dependency injection and cannot be enabled by an asset manifest.

### First-Party Windows Assets

First-party Windows executables, including the overlay and installer, require all of:

1. A valid manifest signature.
2. Exact blob and extracted-file SHA-256 hashes and byte sizes.
3. A valid Authenticode chain.
4. A timestamped signature.
5. A publisher identity in the release policy allowlist.

Unsigned development builds may be tested locally only when the manifest marks them `developmentOnly: true`. They are rejected by distribution and offline-bundle release gates.

### Third-Party Unsigned Assets

An unsigned third-party binary such as the current `cua-driver` is accepted only when all of these checks pass:

1. The Astraclaw asset manifest signature is valid.
2. The downloaded archive matches the manifest SHA-256 and size.
3. `provenance.upstreamSha256` matches the checksum published for the named upstream release asset.
4. Every extracted file matches a manifest-declared SHA-256 and size.
5. The manifest explicitly selects `authenticode.mode: "vendor-unsigned"`.
6. The asset ID, upstream repository, tag, and asset filename match the release allowlist.

The implementation never re-signs a third-party executable as if it were first-party software.

### Microsoft System Runtime

The WebView2 Evergreen Standalone Installer requires a valid manifest signature, exact hash and size, and Authenticode publisher verification for Microsoft Corporation. It is cached for offline use. It is executed only when the doctor confirms WebView2 is missing and the user has approved the system-runtime repair action.

## Asset Manifest Contract

The schema version for PR3 is `2`.

```json
{
  "schemaVersion": 2,
  "packageName": "agent-computer-use-mcp",
  "packageVersion": "0.0.1",
  "releaseId": "0.0.1-windows-x64",
  "generatedAt": "2026-07-10T00:00:00.000Z",
  "expiresAt": "2026-10-08T00:00:00.000Z",
  "signing": {
    "algorithm": "ecdsa-p256-sha256",
    "keyId": "astraclaw-release-2026-01"
  },
  "assets": [
    {
      "id": "cua-driver-windows-x64",
      "kind": "driver",
      "version": "0.7.1",
      "platform": { "os": "win32", "arch": "x64" },
      "requiredBeforeFirstEnable": true,
      "source": {
        "kind": "https-or-offline",
        "urls": ["https://github.com/trycua/cua/releases/download/cua-driver-rs-v0.7.1/cua-driver-rs-0.7.1-windows-x86_64.zip"],
        "fileName": "cua-driver-rs-0.7.1-windows-x86_64.zip",
        "sizeBytes": 7762316,
        "sha256": "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab"
      },
      "content": {
        "format": "zip",
        "files": [
          {
            "path": "cua-driver-rs-0.7.1-windows-x86_64/cua-driver.exe",
            "installPath": "bin/cua-driver.exe",
            "sizeBytes": 11498496,
            "sha256": "6ee5565a36692ee4f4413bbd7336c390d28c7cbdf5c2ec7428024a2e719a54f7",
            "executable": true
          },
          {
            "path": "cua-driver-rs-0.7.1-windows-x86_64/cua-driver-uia.exe",
            "installPath": "bin/cua-driver-uia.exe",
            "sizeBytes": 7640576,
            "sha256": "c6e6748f05fa74e68abbea53b8e8eff1fa981ab7085104f746dfb27a16baa5cd",
            "executable": true
          }
        ]
      },
      "provenance": {
        "class": "third-party",
        "repository": "trycua/cua",
        "tag": "cua-driver-rs-v0.7.1",
        "assetName": "cua-driver-rs-0.7.1-windows-x86_64.zip",
        "upstreamSha256": "00dfa76c5008db20c55ed0cc951388b0f25d1221f6995e5f131dcd6bc4fc5aab"
      },
      "authenticode": { "mode": "vendor-unsigned" },
      "install": {
        "view": "cua-driver",
        "entryPoint": "bin/cua-driver.exe"
      }
    }
  ]
}
```

The example contains values verified from the official x64 archive on 2026-07-10. `installPath` makes archive-root stripping explicit; materialization never infers a path transformation from an archive filename.

Manifest URLs never contain access tokens. Private mirrors use host-side authenticated transport configuration keyed by mirror ID; credentials are not serialized into the manifest.

## OCR Pack Normalization

The native OCR sidecar currently consumes these three files:

- `PP-OCRv6_det_small.onnx`
- `PP-OCRv6_rec_small.onnx`
- `ppocrv6_dict.txt`

The third required file is the recognition dictionary, not a `cls.onnx` model. PR3 aligns the generic model-pack manifest and doctor with the actual sidecar contract. Any future angle-classification model is an explicit compatible manifest revision rather than a fake required file.

## Cache Layout

The Windows layout is rooted at `%LOCALAPPDATA%\Programs\AgentComputerUse`:

```text
cache/
  downloads/
    <sha256>.partial
    <sha256>.resume.json
  assets/
    sha256/<first-two>/<sha256>/blob
    sha256/<first-two>/<sha256>/blob.json
  manifests/
    <release-id>/asset-manifest.json
    <release-id>/asset-manifest.sig
assets/
  <asset-id>/<version>/<blob-sha256>/...
state/
  asset-state.json
  asset-state.previous.json
transactions/
  asset-<operation-id>/...
```

Cached blobs and materialized version directories are immutable. A matching existing hash is re-read and verified before reuse. A different payload cannot reuse an existing asset version.

`asset-state.json` records schema version, current and previous release IDs, revision, activation time, active asset IDs, immutable roots, entry points, and manifest hashes. It is written through a write-through temporary file and atomic rename.

## Acquisition

### Source Adapters

The materializer supports exactly two production adapters:

- `offline`: read a blob from an explicitly selected offline bundle root;
- `https`: download from a signed-manifest URL.

Offline is attempted first. Network acquisition requires explicit user approval and `allowNetwork: true`. A missing offline blob with network disabled produces a repairable `asset.offline_blob_missing` result and never silently falls through to the network.

### Resumable HTTP

The HTTPS adapter:

1. Uses bounded redirects and rejects protocol downgrade.
2. Writes only to `<hash>.partial`.
3. Records expected hash, expected size, ETag, Last-Modified, source URL, and downloaded bytes in `<hash>.resume.json`.
4. Resumes with `Range` and `If-Range` when metadata matches.
5. Restarts from zero if the server ignores Range or the validator changes.
6. Enforces connect, idle, and total operation timeouts.
7. Enforces the manifest size before and while streaming.
8. Flushes the completed file before hashing and promotion.
9. Atomically promotes only a verified blob into the content-addressed cache.

Cancellation terminates the request and leaves only a validated partial plus resume metadata. A later approved operation may resume it. Hash mismatch, oversize, or invalid metadata deletes the partial and reports a fail-closed error.

## Safe Materialization

Raw files and ZIP archives are supported. ZIP extraction rejects:

- absolute, drive-qualified, empty, dot, or parent paths;
- case-insensitive duplicate output paths;
- symbolic links and reparse-point entries;
- alternate data stream path syntax;
- undeclared files;
- file count, per-file size, or aggregate expanded-size limit violations.

Extraction occurs only under a transaction directory. The implementation verifies every declared extracted file before atomically moving the immutable version directory into place. Transaction cleanup never follows reparse points.

## Installation And Rollback

`asset-prepare` performs manifest verification, acquisition, blob verification, safe materialization, Authenticode policy verification, and preflight entry-point checks. It does not activate assets until all selected required assets are ready.

`asset-activate` atomically switches `asset-state.json`. Existing processes continue using their current files; new daemon sessions resolve paths from the new state. The previous state is retained until the next successful doctor run.

`asset-rollback` verifies the previous manifest and every referenced immutable asset before swapping current and previous state. Missing or corrupted previous assets make rollback fail closed.

The protected npm package remains an in-place package dependency. The asset state supplies stable resolved paths for `cua-driver`, overlay, OCR model root, optional runtime payload, and WebView2 installer. The MCP installation manifest reports resolved active paths rather than assuming legacy fixed directories.

## Native Installer Commands

The NativeAOT helper adds these structured commands:

```text
asset-verify-manifest --manifest <path> --signature <path> --trust-keyring <path>
asset-prepare --manifest <path> --signature <path> --trust-keyring <path> --asset-id <id>... [--offline-root <path>] [--allow-network]
asset-activate --release-id <id>
asset-status
asset-rollback
```

Tests pass explicit program/data roots. Production defaults remain per-user. Asset commands emit newline-delimited progress records followed by one terminal result. Every record includes `operationId`, monotonic sequence, state, percent, asset ID when applicable, and `startsDesktopControl: false` / `includeUserOverlay: false`.

## MCP Repair Lifecycle

`computer.repair` remains backward compatible and gains optional fields:

```json
{
  "operation": "plan | start | status | cancel",
  "operationId": "optional-existing-operation",
  "requestApproval": true,
  "approvalToken": "approval-token",
  "approvalTtlMs": 300000,
  "allowNetwork": false,
  "timeoutMs": 300000,
  "dryRun": true,
  "actionIds": []
}
```

Behavior:

- `plan` is the default and preserves current behavior.
- `start` requires a valid approval token, `dryRun: false`, and explicit selected actions.
- `allowNetwork` defaults to false and must have been included in the approved request.
- approval binds the exact selected action ID set and the `allowNetwork` value; either changing after approval fails closed.
- trust roots and asset source paths are host configuration and are not fields in the public MCP schema.
- `status` returns persisted progress and terminal results without starting work.
- `cancel` terminates the managed helper process, records a terminal cancelled event, and retains safe resumable partials.
- duplicate `start` calls with the same operation ID are idempotent;
- only one asset activation operation may run at a time;
- disconnect, revoke, timeout, or daemon shutdown cancels active host execution and never activates an incomplete asset set.

Progress and terminal state are persisted under the runtime diagnostics root with existing redaction and retention policies. URLs are reduced to scheme/host/path; query strings and credentials are never logged.

## First-Enable Policy

Computer Use enable checks active asset state and doctor results. It never invokes acquisition. Missing required assets return immediately with exact repair entry points.

The overlay starts only after approved Computer Use control begins and all required assets are healthy. Asset acquisition and installation always report `includeUserOverlay: false` and do not capture observations.

## Error Contract

Errors use stable codes, including:

- `asset.manifest_signature_invalid`
- `asset.manifest_expired`
- `asset.source_forbidden`
- `asset.offline_blob_missing`
- `asset.download_timeout`
- `asset.download_cancelled`
- `asset.download_size_mismatch`
- `asset.download_hash_mismatch`
- `asset.resume_metadata_invalid`
- `asset.archive_path_invalid`
- `asset.archive_unexpected_file`
- `asset.payload_hash_mismatch`
- `asset.authenticode_required`
- `asset.authenticode_publisher_mismatch`
- `asset.version_conflict`
- `asset.activation_incomplete`
- `asset.rollback_unavailable`

All failures include a safe operation ID, asset ID when known, retryability, and repair entry point. They never include tokens, private local paths outside product roots, raw signatures, screenshots, or captured UI data.

## Verification Strategy

### Deterministic CI Gate

Phase 7.9 uses generated fixture keys, a local HTTP server, real files, and the real NativeAOT helper to prove:

1. Detached manifest verification and mutation rejection.
2. Offline and HTTP acquisition produce the same content-addressed key.
3. Interrupted HTTP transfer resumes with Range/ETag.
4. ETag changes restart safely.
5. Hash, size, ZIP traversal, undeclared file, and signature-policy failures leave active state unchanged.
6. Cache hits re-verify data and avoid duplicate downloads.
7. Prepare, activate, status, upgrade, and rollback use real filesystem transactions.
8. Approved MCP repair start/status/cancel works through the standard MCP SDK.
9. First enable performs no download.
10. No operation starts desktop control or includes the overlay in observation.

### Live Upstream Gate

`npm run assets:live:cua-driver` is an explicit non-CI command. It downloads the official `cua-driver-rs-v0.7.1` Windows archive, checks the published SHA-256, materializes it in temporary roots, runs `cua-driver --version`, and deletes the temporary installation. It does not modify the user's active install.

External-network instability may skip this live gate only with a structured `skipped_environment` result. Hash, manifest, provenance, or execution mismatches are failures and can never be reported as skipped.

### Release Blocking

Commercial distribution remains blocked when:

- the production asset manifest is unsigned or signed by an unknown key;
- a first-party Windows executable lacks valid timestamped Authenticode;
- an unsigned third-party asset lacks exact upstream provenance;
- the offline-required driver, overlay, or OCR runtime is absent;
- generated artifacts are committed to Git;
- Phase 7.9 or existing release gates fail.

## Compatibility

The existing `computer.*` tool names and stdio MCP transport remain unchanged. New repair input fields are optional. Existing plan-only callers continue to receive the same behavior when `operation` is omitted.

The source workspace continues using development paths. Protected npm releases and installed releases resolve active asset paths from verified asset state. `AGENT_COMPUTER_USE_*` remains the public environment prefix; `XIAOZHICLAW_*` aliases remain compatibility-only.
