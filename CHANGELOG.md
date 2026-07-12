# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.1

- Standard MCP stdio server and client compatibility through `@modelcontextprotocol/sdk`.
- Gateway-managed semantic desktop control with cua-driver, policy tiers, approvals, cancel/revoke/timeout cleanup, local OCR, and a user-only native overlay/cursor.
- Protected public core npm package with exact-version `@xiaozhiclaw/agent-computer-use-win32-x64` optional dependency.
- Immutable Windows x64 platform package containing locked cua-driver, native overlay, ONNX Runtime, PP-OCRv6 small models, licenses, SBOM, and a complete SHA-256 inventory.
- Complete Windows x64 offline ZIP that runs with Node.js 20+ without npm, network access, elevation, or setup software.
- Runtime platform verification fails closed for missing, linked, mismatched, incomplete, extra, or corrupt files before MCP starts.
- npm owns install, upgrade, downgrade, and rollback; runtime download and self-update are absent.
- Tag-only draft-first workflow publishes both npm packages with provenance, runs a clean public install smoke, publishes GitHub Release, and mirrors exact bytes to Gitee.
- Product gates for overlay exclusion, OCR/perception latency, MCP concurrency, runtime soak, app smoke evidence, platform inventory identity, and the 310 MiB complete ZIP limit.
