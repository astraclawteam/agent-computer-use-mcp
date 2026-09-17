# Release Gates

These gates describe the current Windows x64 preview artifact and GitHub Release path. The approved Runtime integration design is in `../superpowers/specs/2026-07-20-computer-use-mcp-convergence-and-runtime-integration-design.md`.

## Artifact contract

- The public asset is `agent-computer-use-mcp-X.Y.Z-win32-x64.tar.gz`.
- The archive contains one `artifact/` root with the Windows x64 SEA executable, driver, overlay, OCR runtime and models, licenses, inventory, checksums, and SBOM.
- Publication verifies the target, version, source commit, complete inventory, links, traversal, duplicate paths, and Windows case-fold uniqueness.

## Runtime contract

- The extracted SEA artifact starts from its verified Windows x64 payload.
- Startup verifies the complete inventory and rejects links, traversal, duplicate paths, and Windows case-fold collisions.
- Runtime performs no download, npm invocation, self-update, or package mutation.
- `computer.repair` returns diagnosis and an exact pinned reinstall command only.

## Offline contract

- The extracted archive starts through `artifact/bin/agent-computer-use-mcp.exe` without system Node, npm, network, elevation, or setup software.
- An official MCP SDK smoke lists tools and calls health and doctor without desktop control.
- The compressed artifact remains below its enforced size limit.

## Release contract

- Only a verified `v*` tag on `main` can produce release artifacts.
- Tag CI defaults to GitHub contents read permission and has no npm publishing or Gitee source credential.
- The dedicated Hub job registers the signed executable through a pinned Hub publisher and repeatedly reads the exact version and executable shape from the public catalog.
- Only the final isolated job receives GitHub contents write permission. It publishes the Hub-verified archive, publisher input, and SHA-256 file to one immutable GitHub Release marked Latest.
- The workflow never bumps, commits, moves tags, writes branches, publishes npm, or mutates Gitee.

## Product safety

- Overlay and cursor appear for Gateway-managed control and stop on cancel, revoke, timeout, disconnect, or shutdown.
- Overlay is absent from Agent observations, OCR, screenshots, traces, and artifacts.
- Password, payment, credential, private, and denied-window policies fail closed.
- Preview release checks cover concurrency, daemon cleanup, and offline runtime behavior.
