# Release Gates

## Package Contract

- Core package is `agent-computer-use-mcp@X.Y.Z`.
- Windows package is `@agent-computer-use/win32-x64@X.Y.Z` with exact version, `os: ["win32"]`, and `cpu: ["x64"]`.
- Core contains no native payload; platform contains no first-party source or source maps.
- npm dry-run inventories, licenses, CycloneDX SBOM, and SHA-256 manifests pass.

## Runtime Contract

- Platform package resolves through Node package resolution or the fixed offline sibling layout.
- Core/platform versions, target, complete inventory, links, traversal, duplicate paths, and Windows case-fold uniqueness are verified before MCP startup.
- Runtime performs no download, npm invocation, self-update, or package mutation.
- `computer.repair` returns diagnosis and an exact pinned reinstall command only.

## Offline Contract

- `agent-computer-use-mcp-X.Y.Z-windows-x64.zip` contains protected core, platform payload, production JavaScript dependencies, licenses, checksums, manifest, and SBOM.
- The extracted ZIP starts with Node.js 20+ and no npm, network, elevation, or setup software.
- Official MCP SDK smoke lists tools and calls health/doctor without desktop control.
- ZIP platform inventory is byte-identical to the npm platform package and compressed size is at most 310 MiB.

## Release Contract

- Only a verified `v*` tag on main can release.
- GitHub draft exists before npm publication.
- Platform npm publishes before core npm; both use provenance.
- A clean runner installs only `agent-computer-use-mcp@X.Y.Z` from public npm and passes MCP smoke before GitHub Release is published.
- GitHub Release includes exactly both npm tarballs, complete ZIP, `checksums.txt`, `release-manifest.json`, and `SBOM.cdx.json`.
- Gitee mirrors those same bytes. Any remote name, size, or SHA-256 mismatch fails the mirror verification job.

## Product Safety

- Overlay/cursor appear for Gateway-managed control and stop on cancel, revoke, timeout, disconnect, or shutdown.
- Overlay is absent from agent observations, OCR, screenshots, traces, and artifacts.
- Password, payment, credential, private, and denied-window policies fail closed.
- Concurrency, daemon cleanup, runtime soak, OCR latency, and real app evidence gates pass.
