# Productization Roadmap

## Complete

- Standard MCP server/client package and strict tool schemas.
- Gateway-managed control lifecycle, policy tiers, approvals, cancellation, revocation, timeout, and overlay cleanup.
- UIA/SOM-first observation, local PP-OCRv6 ONNX sidecar, region/diff scheduling, template matching, and local SOM proposals.
- Native layered overlay and branded cursor with observation exclusion.
- Daemon lifecycle, disconnect cleanup, concurrency gates, and bounded runtime soak.
- Protected core npm package with no first-party source maps.
- Exact Windows x64 optional platform package with immutable SHA-256 inventory.
- Complete offline ZIP assembled from the same platform stage.
- 310 MiB compressed ZIP gate and official MCP SDK offline smoke.
- Tag-only draft-first GitHub/npm workflow with provenance and post-publish clean install smoke.
- Idempotent Gitee Release transport mirror with quota-safe parts, remote hashes, and reconstructed GitHub identity verification.
- Real 900,000 ms pull-request soak with official MCP clients, fault injection,
  Windows resource probes, immutable JSON/JSONL evidence, and fail-closed
  checksum verification.
- Frozen two-hour nightly and eight-hour release-candidate gates, scheduled
  nightly evidence retention, trend comparison, and atomic RC evidence import.

## Before Public 1.0

- Expand real app evidence across Office, Electron, Qt, WPF, Canvas, self-drawn, editing, and industrial software.
- Collect and retain passing two-hour nightly and eight-hour release-candidate
  evidence on prepared Windows runners; the PR6B mechanism is implemented but
  implementation tests do not substitute for those long runs.
- Run clean-runner release rehearsals and retain failed evidence beside passing retries.
- Publish Windows x64 preview versions and validate npm trusted publishing plus GitHub/Gitee recovery procedures.
- Continue OCR screenshot regression and warm region latency tracking.

## Future Platforms

macOS and Linux platform packages remain unpublished. Each platform needs real driver, overlay, OCR runtime, permission, packaging, offline ZIP, and app-matrix validation before it is added to core `optionalDependencies`.
## Preview Browser Boundary

- The public MCP remains OS-only and contains no built-in browser/CDP kernel.
- `PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment.
- Gateway-managed components MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel.
- XiaozhiClaw built-in Preview Browser actions always use the host semantic provider and never receive a raw CDP endpoint.
- Explicit physical control of a built-in preview must use canonical OS tokens and the host's shared target lease.
- Third-party agent-native capabilities remain outside Gateway enforcement; agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement.
- End-to-end agent-native routing is a host-owned invariant; the host runtime, rather than this OS MCP package, owns its executable bypass test.


