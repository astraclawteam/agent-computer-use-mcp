# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.1

- Initial 0.x preview package for Gateway-managed local Computer Use MCP.
- Standard MCP stdio server/client compatibility through `@modelcontextprotocol/sdk`.
- Gateway-managed desktop control lifecycle with `cua-driver mcp`, local overlay, and cursor affordance.
- Productization gates for package foundation, permission policy, runtime recovery, perception hardening, overlay safety, MCP compatibility, app smoke coverage, and install experience.
- Release readiness gate for alpha command manifests, required evidence, and release-blocking invariants.
- Release artifact hash and Windows helper signing verification gate.
- Signed Windows helper inventory proof for required helper artifacts and reserved future sidecars.
- Offline install proof for prepared install roots, offline bundle readiness, and no-network capability enablement.
- First-enable safety proof for bounded waits, no first-enable downloads, and approval-gated repair progress.
- Repair entrypoint catalog for product-safe installer UI actions covering driver, overlay, OCR, WebView2, permissions, and OS features.
- Clean install degraded proof for empty Windows install roots with exact plan-only repair actions and catalog entries.
- Deterministic release bundle builder plus a real .NET install, upgrade, corruption rejection, status, and rollback transaction gate.
- Signed ECDSA asset manifests, offline-first content-addressed cache, resumable approved HTTP acquisition, safe ZIP materialization, Windows trust enforcement, and atomic asset activation/rollback.
- Approval-bound `computer.repair` asset start/status/cancel operations with host-owned trust roots, persistent progress, cancellation, timeout, and official MCP SDK coverage.
- Hash-verified active asset resolution connects activated cua-driver state to runtime and doctor paths.
- Phase 7.9 end-to-end trusted asset delivery release gate with zero first-enable downloads and overlay-free execution.
- Protected npm release staging with esbuild minification, final-pass JavaScript obfuscation, SHA-256 launcher verification, standard MCP smoke, and zero-source/zero-Source-Map tarball gates.
- Real Windows x64 candidate assembly from five locked upstream assets with portable Node.js, protected MCP runtime, NativeAOT installer, native WinForms overlay, PP-OCRv6 small ONNX model pack, CycloneDX SBOM, release manifest, and checksums.
- Phase 0.15 offline installation proof verifies the ZIP's exact internal checksums, activates cua-driver and OCR assets with installer network access disabled, resolves cua-driver through the installed MCP doctor, verifies the native overlay, and starts the server without a machine-wide Node.js runtime; all PR4 outputs remain `blocked_unsigned` until PR5 production signing and clean-runner network isolation.
- PID-aware NativeAOT installer build locking prevents slow cold-runner publishes from being mistaken for stale locks and gives concurrent build/publish waiters commercial CI time budgets.
- Windows release payload assembly reuses the serialized installer publisher, preventing concurrent clean-runner linker writes to the same NativeAOT intermediate files.
- Authenticode verification supplies WinTrust with an open read handle and retries only transient `CRYPT_E_FILE_ERROR` results, preserving offline publisher/timestamp enforcement on clean Windows runners.
- Platform release contract keeps one protected npm package and enables Windows x64 only for GitHub Release; macOS and Linux remain blocked pending real native validation.
- Windows x64 assembly prunes foreign ONNX Runtime native targets, materializes offline assets once by content hash, records runtime/size evidence, and enforces a 310 MiB offline ZIP gate.
- The commercial desktop overlay now draws the closed 24-48px breathing brand river and target frame natively, without WebView2 or HTML assets in the release runtime.
- Tag-only formal release workflow performs public-trust Azure Artifact Signing, production ECDSA asset-manifest signing, draft-first GitHub Release assembly, npm OIDC provenance publishing, post-publish install/MCP smoke, and final release publication.
- Runtime soak gate records concurrent standard MCP calls, injected reconnects, p95 latency, RSS/handle growth, overlay exclusion, desktop-control isolation, and orphan-process cleanup; CI runs a short gate and nightly runs two hours.
- Real app smoke runner records sanitized executable hashes and live provider evidence for Notepad, WinForms, Edge, VS Code, and a fail-closed canvas fixture; unavailable Qt, WPF, Office, and CAD labs remain explicitly blocked.
- Commercial policy-deny proof for password, payment, credential, and private surfaces.
- Computer control approval state machine for approve, deny, cancel, revoke, and timeout flows.
- MCP approval compatibility proof for pending approval schemas, duplicate-pending rejection, and disconnect cleanup.
- Daemon session proof for lock ownership, child supervision, duplicate startup blocking, and clean shutdown.
- Daemon session doctor/repair proof for exposing degraded child state and approval-gated recovery through standard MCP tools.
- Runtime cleanup proof for stale daemon locks and expired runtime temp files without desktop control.
- Runtime cleanup doctor/repair proof for exposing cleanup actions through standard MCP tools.
- Perception latency budget proof for warm OCR crop, ordinary region, and diagnostic full-window OCR targets.
- Standard MCP multi-client stress proof for read-only concurrent calls without overlay capture or desktop control.
- Public MCP contract review proof covering every `computer.*` tool and release-risk checklist.
