# Platform Release Bundles And Windows x64 Runtime Slimming

Status: approved and implemented

Date: 2026-07-10

## Context

PR4 produced a real Windows x64 offline candidate containing a protected MCP
runtime, portable Node.js, NativeAOT installer, overlay, cua-driver, PP-OCRv6
models, checksums, and a CycloneDX SBOM. The candidate is fully
offline but its ZIP is 433.82 MiB.

The offline asset layout does not currently duplicate cua-driver or OCR models
between `assets/blobs` and `release/payload`. Each installable asset
already has one content-addressed blob. Most avoidable payload size comes from
`onnxruntime-node`: the installed package is 258.28 MiB and includes native
binaries for Darwin ARM64, Linux ARM64, Linux x64, Windows ARM64, and Windows
x64. The Windows x64 release needs only the 61.35 MiB Windows x64 native set.

The product also needs a durable cross-platform release shape. A single
universal offline archive would force every user to download unrelated native
runtimes and would make platform signing and smoke evidence ambiguous.

## Decisions

1. The public user-facing npm package remains `agent-computer-use-mcp` and uses
   the standard MCP protocol.
2. A single `v*` tag owns all release channels for that version.
3. GitHub Release publishes target-specific installers and offline bundles.
4. Windows x64 is the only target implemented and published in the current
   scope.
5. macOS and Linux targets remain unavailable until their native overlay,
   installer, permissions, signing, and real-application smoke matrices pass.
6. The Windows x64 bundle includes only Windows x64 ONNX Runtime native files.
7. Each installable asset is carried exactly once as a content-addressed blob.
   The installer materializes cache and activated views from that blob after
   extraction; activated asset views are not embedded in the release payload.
8. The Windows x64 offline candidate has a hard maximum size of 310 MiB.
9. The Windows overlay renders the closed 24-48px brand river and target frame
   natively. It does not depend on WebView2 or release-time HTML assets.

## Validation Amendment

After ONNX Runtime target pruning, the first real build produced a
383,363,617-byte ZIP (365.6 MiB) and correctly failed the 310 MiB gate. The
same run showed that the self-contained WebView2 overlay payload lacked its
HTML assets, while the WebView2 offline installer contributed about 194 MiB.
The durable fix is the native overlay decision above, not a larger size limit
or a first-enable download. The formal Windows release therefore has five
locked upstream inputs and two installable content-addressed asset blobs.

## Goals

- Reduce the Windows x64 offline bundle from 433.82 MiB to at most 310 MiB.
- Preserve offline install, repair, cache verification, activation, rollback,
  and first-enable behavior.
- Reject native runtime files for any target other than Windows x64.
- Introduce a target schema that later release builders can reuse.
- Keep release manifests, checksums, SBOMs, and signatures target-specific.
- Keep unsupported targets absent rather than publishing partial placeholders.

## Non-Goals

- Implementing or publishing macOS or Linux installers in this change.
- Changing OCR models or replacing the current OCR API.
- Producing a custom reduced-operator ONNX Runtime build.
- Changing public npm provenance or the PR5 tag-driven release workflow.
- Reducing installed cache size by deleting rollback blobs.
- Moving native runtime delivery into platform-specific npm packages.

## Considered Approaches

### Universal offline archive

One archive would contain all platform runtimes. It has the simplest release
list but the worst download size, broadest attack surface, and weakest platform
evidence. It is rejected.

### Core npm package plus target-specific GitHub Release assets

This is the selected approach. Users see one MCP package name while native
installers and offline bytes are built, signed, tested, and downloaded per
target. A target failure cannot be hidden by another target's successful build.

### Public meta package plus platform-specific npm packages

This pattern can make normal npm installation smaller through `os`, `cpu`, and
`libc` constraints and optional dependencies. It also multiplies protected npm
packages, provenance statements, version synchronization, and takeover risk.
It remains a possible later optimization, not part of the PR5 prerequisite.

## Target Model

Release code uses a canonical target object:

```json
{
  "id": "windows-x64",
  "os": "win32",
  "arch": "x64",
  "libc": null,
  "accelerator": "directml-cpu"
}
```

Future canonical targets include:

| Release target | Runtime identity | Initial archive format | Publication state |
| --- | --- | --- | --- |
| `windows-x64` | `win32/x64` | installer `.exe`, offline `.zip` | enabled |
| `macos-arm64` | `darwin/arm64` | installer `.pkg`, offline `.tar.zst` | blocked |
| `linux-x64-glibc` | `linux/x64/glibc` | installer package, offline `.tar.zst` | blocked |
| `windows-arm64` | `win32/arm64` | installer `.exe`, offline `.zip` | blocked |
| `macos-x64` | `darwin/x64` | installer `.pkg`, offline `.tar.zst` | blocked |
| `linux-arm64-glibc` | `linux/arm64/glibc` | installer package, offline `.tar.zst` | blocked |

`os`, `arch`, and `libc` use Node/npm vocabulary. Human-facing filenames use
`windows`, `macos`, and `linux` for clarity. Accelerator variants are explicit
when their runtime bytes or system requirements differ.

## Release Layout

The user-facing npm package remains one protected protocol and control-plane
package. A GitHub Release for `v0.1.0` may eventually contain:

```text
agent-computer-use-mcp-0.1.0-windows-x64-installer.exe
agent-computer-use-mcp-0.1.0-windows-x64-offline.zip
agent-computer-use-mcp-0.1.0-macos-arm64.pkg
agent-computer-use-mcp-0.1.0-macos-arm64-offline.tar.zst
agent-computer-use-mcp-0.1.0-linux-x64-glibc.tar.zst
agent-computer-use-mcp-0.1.0-checksums.txt
agent-computer-use-mcp-0.1.0-sbom-index.json
```

Only the Windows x64 target artifacts are allowed in the current implementation.
Shared artifacts such as the protected npm package, checksums, manifests, and
SBOMs remain part of the release. Checksums and the SBOM index may aggregate
target artifacts, but each target also has an exact manifest and CycloneDX
component inventory.

## Windows x64 Runtime Selection

The release payload builder installs production dependencies into staging and
then applies a fail-closed target selection before materializing the immutable
payload.

For `onnxruntime-node`, the selector must retain package JavaScript and metadata
needed by Node resolution plus only:

```text
node_modules/onnxruntime-node/bin/napi-v6/win32/x64/
  DirectML.dll
  dxcompiler.dll
  dxil.dll
  onnxruntime.dll
  onnxruntime_binding.node
```

It must reject or remove all native directories under:

```text
darwin/
linux/
win32/arm64/
```

The selector is package-version-aware. It first validates the expected native
root and required Windows x64 files. Missing required files, unknown native
platform directories, linked entries, path escapes, or a target mismatch fail
the release build. It must not silently keep all native binaries when the
package layout changes.

Generic pruning rules live behind a target-runtime selection module rather
than being embedded as ad hoc copy exclusions. Future target implementations
must add a target policy and tests before they can enter a release manifest.

## Single Asset Materialization

The offline archive maintains two distinct categories:

- `release/payload`: application runtime, portable Node.js, installer, and
  overlay for exactly one target;
- `assets/blobs/sha256/<hash>`: one archive blob for each installable driver,
  OCR model pack, or system runtime.

The following invariants apply:

1. Every asset manifest entry maps to exactly one blob path.
2. No asset payload file is copied into `release/payload` as an activated view.
3. No two asset IDs may claim the same path with conflicting identity.
4. Every blob is covered by the signed asset manifest and internal checksums.
5. The NativeAOT installer verifies the blob before cache insertion and creates
   the activated view transactionally at install or repair time.
6. Rollback blobs remain available according to the existing retention policy;
   removing them is not a package-size optimization.

## Data Flow

```text
target policy
  -> install locked production dependencies
  -> validate required target-native files
  -> remove foreign target-native files
  -> build protected target payload
  -> acquire and verify target asset blobs
  -> assemble target offline bundle
  -> generate target manifest, checksums, and SBOM
  -> enforce target inventory and size gates
  -> install and smoke without network
```

No stage may infer a target from the build host after the canonical target is
selected. The requested target is passed explicitly through payload, bundle,
manifest, SBOM, and verification APIs.

## Trust And Signing

- Target identity is signed into the release manifest and asset manifest.
- Windows PE inventory remains subject to production Authenticode in PR5.
- A target bundle containing a foreign native runtime is non-publishable.
- Checksums cover the exact post-selection bytes.
- SBOM components include target qualifiers where the package supports them.
- macOS and Linux require separate signing and platform trust policies before
  their publication state can change from blocked.

## Failure Behavior

Release assembly fails closed when:

- the target is unsupported;
- required target-native files are missing;
- foreign native files remain after selection;
- an asset appears outside its single content-addressed blob;
- manifest, checksum, or SBOM target identity disagrees;
- the Windows x64 offline ZIP exceeds 310 MiB;
- offline installation attempts network access;
- install, repair, activation, rollback, or standard MCP smoke fails.

Failures preserve the previous candidate through the existing atomic promotion
contract. Size failure is a release failure, not a warning.

## Verification

TDD implementation adds focused evidence for:

- canonical target validation;
- Windows x64 ONNX Runtime allowlist and required-file validation;
- rejection of Darwin, Linux, and Windows ARM64 native entries;
- release payload execution using the retained Windows x64 binding;
- one blob per installable asset and no activated asset views in payload;
- target identity in release manifest, checksums, and SBOM;
- deterministic target bundle assembly;
- a hard `<= 310 MiB` candidate size gate;
- protected npm package containing no source or Source Maps;
- Phase 0.15 offline install and standard MCP smoke;
- full test and clean Windows runner compatibility.

The implementation must record before/after component and archive sizes so a
later dependency update cannot hide a package-size regression.

## Rollout

1. Add the target model and tests without changing output bytes.
2. Add Windows x64 runtime selection with red-green tests.
3. Add asset single-materialization and foreign-runtime inventory gates.
4. Rebuild the real Windows x64 candidate and enforce the 310 MiB limit.
5. Re-run offline installation, repair, rollback, MCP, SBOM, and trust gates.
6. Merge this prerequisite before PR5 release workflow implementation.
7. Add macOS ARM64 and Linux x64 glibc only in later platform-specific phases
   with real hardware or hosted-runner evidence and native application smoke.

## References

- npm `os`, `cpu`, `libc`, and optional dependency contract:
  <https://docs.npmjs.com/files/package.json/>
- GitHub Release assets and tag-based releases:
  <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>
- ONNX Runtime Node.js supported target matrix:
  <https://onnxruntime.ai/docs/get-started/with-javascript/node.html>
- cua-driver platform release assets:
  <https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.7.1>
