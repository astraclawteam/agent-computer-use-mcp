# Release Gates

## Package Contract

- Core package is `agent-computer-use-mcp@X.Y.Z`.
- Windows package is `@xiaozhiclaw/agent-computer-use-win32-x64@X.Y.Z` with exact version, `os: ["win32"]`, and `cpu: ["x64"]`.
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
- Gitee keeps each asset at or below 90 MiB byte-identical and deterministically splits larger assets into 90 MiB parts.
- The Gitee manifest, every part hash, and each reconstructed original size and SHA-256 must match the published GitHub inventory. Any mismatch fails closed.
- A Gitee repair run consumes an immutable published GitHub tag and assets; it cannot rebuild, publish npm, or move a tag.

## Product Safety

- Overlay/cursor appear for Gateway-managed control and stop on cancel, revoke, timeout, disconnect, or shutdown.
- Overlay is absent from agent observations, OCR, screenshots, traces, and artifacts.
- Password, payment, credential, private, and denied-window policies fail closed.
- Concurrency, daemon cleanup, runtime soak, OCR latency, and real app evidence gates pass.

## Commercial Runtime Evidence

- Pull-request CI runs `npm run soak:pr` for exactly 900,000 ms after all MCP
  sessions and the baseline process probe are ready.
- RSS net growth is at most 128 MiB, handle net growth is at most 128 handles,
  and the tool-call failure rate is below 0.1%.
- Cleanup requires zero orphan processes, residual ports, overlay leaks, and
  cursor leaks. Safety-policy errors must fail closed.
- The evidence directory contains `run-manifest.json`, append-only
  `events.jsonl`, `report.json`, and `checksums.txt` bound to the exact Git,
  package, driver, overlay, OCR, and model identities.
- `npm run evidence:verify -- <evidence-directory>` recomputes every inventory
  entry and rejects tampering, unreferenced files, dirty-worktree identity, and
  candidate mismatch.
- Complete screenshots and user documents are forbidden. Tokens, user-profile
  paths, host names, command lines, and executable paths are rejected before
  evidence sealing.
