# Real Release Pipeline Specification

## Status

- Decision: approved for implementation on 2026-07-10.
- Release channels: GitHub Release and public npm in one tag-driven workflow.
- Initial platform: Windows x64.
- Release channel: `0.x-preview`.
- Distribution topology: one protected npm package plus platform-specific GitHub Release assets.
- Enabled target: Windows x64 only. macOS and Linux require real native validation before publication is enabled.

## Objective

Turn the current release proofs, transaction engine, protected npm staging package, and trusted asset materializer into one production distribution flow.

A successful `vX.Y.Z` release must publish:

- a public npm package built only from the protected staging directory;
- a signed Windows NativeAOT installer;
- a complete offline Windows bundle;
- signed release and asset manifests;
- SHA-256 checksums;
- a CycloneDX SBOM;
- one GitHub Release whose tag and artifacts match the npm version.

The workflow fails closed when production signing, npm trusted publishing, asset provenance, artifact verification, or post-publish verification is unavailable. Development and test signatures are never distributable.

## Hard Constraints

1. A formal release is triggered only by a pushed tag matching `v*`.
2. The tag must equal `v${package.json.version}`, point to a commit on `main`, and have a matching `CHANGELOG.md` heading.
3. The source workspace remains non-publishable. Only `artifacts/npm-release/package` may be sent to npm.
4. npm publishing uses GitHub-hosted runners, OIDC trusted publishing, and provenance. No long-lived npm write token is accepted by the workflow.
5. First-party Windows PE files require a production public-trust Authenticode signature and trusted timestamp.
6. Test, private-trust, self-signed, expired, untimestamped, or unexpected-publisher signatures block distribution.
7. The production asset manifest uses the existing detached ECDSA P-256 signature contract. Its private key remains outside Git, npm, workflow artifacts, logs, and release assets.
8. Upstream unsigned `cua-driver` remains allowed only through the signed exact-provenance policy already implemented by Phase 7.9.
9. The user overlay remains excluded from observation, OCR, screenshots, traces, SBOM content, and release verification artifacts.
10. Generated release files remain ignored and are never committed.
11. Windows GitHub distribution must run on a clean Windows x64 machine without a preinstalled Node.js runtime.
12. No download occurs during first enable. Network acquisition is an explicit, progress-aware install or repair operation.

## Approach Decision

### Selected: NativeAOT installer plus deterministic release bundles

The existing `AgentComputerUse.Installer` remains the sole writer of release and asset activation state. Release assembly adds a production bootstrap contract around that engine, a portable Node.js runtime for the GitHub channel, and deterministic online/offline payloads.

This keeps install, upgrade, rollback, repair, and runtime resolution on the transaction model already tested by Phases 7.8 and 7.9. The installer remains suitable for Gateway-driven and quiet installation. A separate graphical setup shell may be added later without owning installation state.

### Rejected for this phase: WiX/Burn or Inno Setup

These can provide a conventional wizard and Add/Remove Programs UX, but adding one now would introduce a second packaging state machine before the payload contract is stable. A future shell may invoke the NativeAOT engine and must not bypass its verification or rollback rules.

### Rejected: MSIX as the primary format

MSIX isolation and update rules do not match the current host-owned mutable asset cache, side-by-side release activation, external MCP clients, and optional native helpers. It may be evaluated later as an additional channel, not as the source of truth.

## Release Identity

One immutable release identity drives every artifact:

```text
packageName: agent-computer-use-mcp
version:     X.Y.Z
tag:         vX.Y.Z
commit:      full Git SHA
channel:     preview
platform:    windows-x64
```

The release manifest records the identity plus every output path, byte length, SHA-256, media type, signing policy, and channel. Artifact names are deterministic:

```text
agent-computer-use-mcp-X.Y.Z.tgz
agent-computer-use-mcp-X.Y.Z-windows-x64-installer.exe
agent-computer-use-mcp-X.Y.Z-windows-x64-offline.zip
agent-computer-use-mcp-X.Y.Z-release-manifest.json
agent-computer-use-mcp-X.Y.Z-asset-manifest.json
agent-computer-use-mcp-X.Y.Z-asset-manifest.sig
agent-computer-use-mcp-X.Y.Z-keyring.json
agent-computer-use-mcp-X.Y.Z-sbom.cdx.json
agent-computer-use-mcp-X.Y.Z-checksums.txt
```

The release manifest itself is included in `checksums.txt`. GitHub Actions artifact attestations may be added as supplementary evidence, but they do not replace Authenticode, npm provenance, or the asset-manifest signature.

## Product Payload

### Shared protected MCP runtime

Both channels use the exact protected `dist` produced by `release:npm:build`. Source, tests, C# or Python files, Source Maps, relative source imports, and unobfuscated first-party entry points remain prohibited.

The npm package declares normal production dependencies and requires Node.js `>=20`. The Windows release contains an approved portable Node.js runtime so Gateway installation does not depend on a machine-wide Node installation.

### Windows release bundle

The Windows core release bundle contains:

- protected MCP `dist` and integrity manifest;
- production Node dependencies needed by the MCP server and OCR sidecar;
- portable Node.js runtime pinned by the release manifest;
- signed Gateway overlay output;
- the signed NativeAOT installer;
- host configuration templates and license notices.

The installed runtime entry point is resolved from the active immutable release. It must not resolve to the source checkout or a global npm installation.

### Offline asset bundle

The offline ZIP is consumable directly by the NativeAOT installer and contains:

```text
installer/
release/
assets/blobs/sha256/
trust/asset-manifest.json
trust/asset-manifest.sig
trust/keyring.json
metadata/release-manifest.json
metadata/sbom.cdx.json
metadata/checksums.txt
licenses/
```

It carries every component required to enable Computer Use without network access:

- official pinned Windows x64 `cua-driver` archive and exact extracted-file hashes;
- signed Gateway overlay shell;
- portable Node.js runtime;
- ONNX Runtime native package selected for Windows x64;
- PP-OCRv6 small detection, recognition, and dictionary files;
- third-party notices and component licenses.

The Windows x64 bundle must not exceed 310 MiB. Release assembly prunes `onnxruntime-node@1.27.0` to the exact Windows x64 DirectML/CPU native inventory, stores each installable asset once as a content-addressed blob, and records target, retained/removed runtime bytes, asset/blob counts, and actual ZIP size in the release manifest. `npm run release:windows:size-report` re-stats the final artifact and fail-closes on any mismatch. Components must never be removed merely to defer them to first-enable downloads.

## Signing And Trust

### First-party Authenticode

The initial formal workflow signs all first-party PE files after build and before release assembly with an organization-owned public-trust Authenticode certificate imported temporarily from the protected `release` environment. The Windows job uses `signtool`, removes the imported certificate and temporary PFX in a guaranteed cleanup step, and produces the following verification evidence:

- Windows trust chain succeeds with `WinVerifyTrust` and `signtool verify /pa /all`;
- signer identity matches the release environment's expected publisher policy;
- code-signing EKU is present;
- RFC 3161 timestamp is valid;
- no test or private-trust profile is accepted.

The protected environment provides `WINDOWS_SIGNING_CERTIFICATE_BASE64`, `WINDOWS_SIGNING_CERTIFICATE_PASSWORD`, `WINDOWS_SIGNING_EXPECTED_SUBJECT`, and `WINDOWS_SIGNING_TIMESTAMP_URL`. All four values are mandatory. The workflow never echoes them, never uploads the PFX, and rejects a certificate whose chain, subject, EKU, validity, or timestamp policy is not production-ready.

Azure Artifact Signing Public Trust may replace the certificate-import step in a later PR, but it must feed the same signed-file inventory and pass the same independent verification contract. It is not a fallback for a missing certificate in this release implementation.

### Asset manifest

The production ECDSA signing key is distinct from Authenticode credentials. Release assembly signs the exact asset-manifest bytes, verifies them using the shipped public keyring, and then deletes all private-key working material. The workflow uploads only the manifest, detached signature, and public keyring.

### Third-party assets

- `cua-driver`: signed manifest plus exact official release archive and extracted-file hashes; Authenticode mode remains `vendor-unsigned`.
- Node.js: exact pinned download, SHA-256, and license evidence.
- ONNX Runtime and OCR models: exact package/release identity, SHA-256, file inventory, and license evidence.

## GitHub Actions Workflow

The formal workflow is `.github/workflows/release.yml` and has the following ordered jobs.

### 1. `validate`

- Run on a GitHub-hosted runner with read-only contents permission.
- Check tag, package version, changelog, main ancestry, clean lockfile, and immutable artifact names.
- Run release policy tests and metadata gates.
- Emit a canonical release identity artifact.

### 2. `build-windows`

- Use a Windows GitHub-hosted runner.
- Install with `npm ci` and no release cache reuse.
- Run the full deterministic test suite and protected npm smoke.
- Publish the NativeAOT installer and self-contained native overlay.
- Acquire only release-pinned upstream assets.
- Build the portable Windows release and offline asset bundle staging trees.
- Mark all unsigned output as `candidate-only`; it cannot be uploaded to a release.

### 3. `sign-windows`

- Enter the protected `release` GitHub environment.
- Fail before signing when the production provider configuration or expected publisher policy is absent.
- Sign every first-party PE file and verify every signature independently.
- Reject any candidate containing development-only trust material.

### 4. `assemble`

- Build the production asset manifest and detached signature.
- Assemble the installer, offline ZIP, protected npm tarball, SBOM, third-party notices, release manifest, and checksums.
- Re-open every archive and verify its inventory and hashes.
- Run an offline install, MCP initialize/list/call smoke, upgrade, and rollback against the assembled artifacts.
- Generate release evidence with no desktop control and `includeUserOverlay=false`.

### 5. `draft-github-release`

- Create or reuse a draft GitHub Release for the exact tag.
- Upload only assembled, signed, verified artifacts.
- Refuse to overwrite an artifact with different bytes.
- Keep the release draft until npm publication and registry verification succeed.

### 6. `publish-npm`

- Use a GitHub-hosted runner with Node.js `>=22.14.0`, npm `>=11.5.1`, and `id-token: write`.
- Download the already-verified protected staging package; do not rebuild it.
- Publish from the staging directory with public access and npm trusted publishing.
- Do not provide `NODE_AUTH_TOKEN` or any long-lived write credential.
- Verify registry name, version, tarball integrity, repository identity, and provenance after publication.

The npm package is published directly to the `preview` dist-tag for the 0.x channel. npm publication is immutable and cannot participate in a distributed transaction with GitHub Releases.

### 7. `publish-github-release`

- Publish the existing draft only after npm registry verification succeeds.
- Verify the public release contains exactly the release-manifest inventory.
- Emit a terminal release report linking the tag, commit, GitHub Release, npm package, and artifact hashes.

## Cross-Channel Failure Semantics

GitHub Releases and npm do not provide one atomic transaction. The workflow therefore uses an ordered, resumable protocol:

1. signed artifacts are private workflow artifacts;
2. GitHub Release is a draft;
3. npm package is published and verified;
4. GitHub Release is published.

Failures before npm publication leave no public release. A failure after npm succeeds leaves the GitHub Release in draft and the workflow failed; rerunning for the same tag must reuse the exact npm integrity and complete GitHub publication. If npm already contains the version with different bytes or provenance, the workflow fails permanently and requires a new version. Published npm versions are never overwritten or deleted by automation.

## Permissions And Secrets

Workflow permissions are job-scoped:

- build and validation: `contents: read`;
- npm trusted publishing: `contents: read`, `id-token: write`;
- Windows signing: `contents: read`, with secrets scoped only to the protected `release` environment job;
- GitHub draft/final release: `contents: write`;
- optional GitHub artifact attestation: only the documented attestation permission.

The `release` environment must be protected by human approval. It owns signing provider configuration, expected publisher identity, production asset-manifest signing material, and release policy variables. Fork pull requests never receive these values and cannot invoke formal publication.

## SBOM And License Evidence

The release uses npm's built-in SBOM command to generate CycloneDX JSON from the locked production dependency graph. Release assembly augments component evidence for portable Node.js, the native overlay, installer, `cua-driver`, ONNX Runtime, and OCR models.

SBOM and third-party notices are validated for required component IDs. Missing license or provenance data blocks release. The SBOM contains paths and package identities, never secrets, local user paths, screenshots, OCR text, or overlay pixels.

## Idempotency And Recovery

- A draft release is reused only when tag and target commit match.
- Uploaded assets are content-addressed by the release manifest; different bytes under the same name are rejected.
- npm preflight checks whether the version exists. An exact existing version is accepted only as a resume case after integrity and provenance verification.
- Installer and asset activation retain their existing side-by-side rollback behavior.
- Temporary signing, extraction, download, and assembly roots are removed in `finally` paths.
- A failed release run never mutates `main`, the source checkout, or a user's active installation.

## Verification Matrix

### Pull request and normal CI

- Unit-test release identity, artifact inventory, checksum, SBOM, signing policy, and workflow-policy validation.
- Build real unsigned candidate binaries and prove their distribution status is blocked.
- Run protected npm build, pack, integrity smoke, NativeAOT build, release assembly fixtures, and offline transaction tests.
- Never use production signing or npm publishing credentials.

### Formal tag workflow

- Run all normal CI verification again from the tagged commit.
- Sign and independently verify real Windows outputs.
- Assemble and re-verify the final offline bundle.
- On a clean Windows runner with network disabled for the install phase:
  - install with no preinstalled Node.js;
  - initialize the standard MCP server;
  - list tools and call `computer.health({fast:true})`;
  - verify overlay and configured OCR assets are present;
  - upgrade from the previous retained fixture release;
  - roll back and verify the prior release;
  - prove no first-enable download and no overlay in observations.
- Publish and verify npm provenance.
- Publish and inventory-check the GitHub Release.

## Acceptance Criteria

1. A valid `vX.Y.Z` tag produces both a public npm package and a public GitHub Release for exactly `X.Y.Z`.
2. The GitHub Release contains the signed Windows installer, complete offline ZIP, checksums, release/asset manifests, public keyring, and CycloneDX SBOM.
3. The npm artifact contains no first-party source, tests, C#/Python source, Source Maps, or unobfuscated runtime entry points.
4. npm displays provenance tied to the expected repository and `release.yml` workflow.
5. Every first-party PE passes production Authenticode and trusted timestamp verification; any test or missing signature fails the workflow.
6. The full offline ZIP installs and starts the MCP server on clean Windows x64 without network or preinstalled Node.js.
7. Installed release and asset state support verified upgrade and rollback.
8. Re-running a partially completed workflow is safe and cannot replace npm or GitHub bytes with different content.
9. Missing signing materials, npm trusted-publisher configuration, asset provenance, SBOM components, or post-publish verification fails the workflow.
10. All release reports preserve `startsDesktopControl=false` and `includeUserOverlay=false`.

## External Prerequisites

These must be configured before the first real tag can succeed:

- npm ownership of `agent-computer-use-mcp` and a trusted publisher bound to `astraclawteam/agent-computer-use-mcp`, `release.yml`, and the `release` environment;
- a protected GitHub `release` environment with required reviewer approval;
- a production public-trust Authenticode PFX, password, expected publisher subject, and RFC 3161 timestamp URL in the protected `release` environment;
- a production ECDSA asset-manifest signing key and corresponding public keyring;
- protected release tags or an equivalent organization policy controlling `v*` creation.

The implementation must make each missing prerequisite an explicit machine-readable blocker. It must not substitute development credentials.

## Non-Goals

- Publishing a release from a pull request or manual local command.
- Supporting macOS, Linux, or Windows arm64 in the first real release.
- Building a second install-state engine inside WiX, MSIX, Inno Setup, or a GUI shell.
- Hiding open-source implementation details through native compilation claims.
- Automatically deleting or replacing a published npm version.
- Downloading any component during first enable.

## Authoritative References

- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements/
- GitHub OIDC: https://docs.github.com/en/actions/reference/security/oidc
- GitHub artifact attestations: https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- Microsoft Artifact Signing: https://learn.microsoft.com/en-us/azure/artifact-signing/overview
- Microsoft Windows code-signing options: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
