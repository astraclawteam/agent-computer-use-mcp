# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.2

- Expose the existing cua-driver `type_text` capability through `computer.act` so modern Windows Notepad document surfaces can be edited without weakening observation or policy checks.

## 0.0.1

- Standard MCP stdio server and client compatibility through `@modelcontextprotocol/sdk`.
- Gateway-managed semantic desktop control with cua-driver, policy tiers, approvals, cancel/revoke/timeout cleanup, local OCR, and a user-only native overlay/cursor.
- Protected public core npm package with exact-version `@xiaozhiclaw/agent-computer-use-win32-x64` optional dependency.
- Immutable Windows x64 platform package containing locked cua-driver, native overlay, ONNX Runtime, PP-OCRv6 small models, licenses, SBOM, and a complete SHA-256 inventory.
- Complete Windows x64 offline ZIP that runs with Node.js 20+ without npm, network access, elevation, or setup software.
- Runtime platform verification fails closed for missing, linked, mismatched, incomplete, extra, or corrupt files before MCP starts.
- npm owns install, upgrade, downgrade, and rollback; runtime download and self-update are absent.
- Tag-only CI validates, builds, smokes, and uploads only the two npm tarballs; npm publication is an explicit maintainer action for one verified tarball at a time.
- Product gates for overlay exclusion, OCR/perception latency, MCP concurrency, runtime soak, app smoke evidence, platform inventory identity, and the 310 MiB complete ZIP limit.
