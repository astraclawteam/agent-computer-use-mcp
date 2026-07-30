# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.9

- Ground custom-drawn text entry from the complete editable surface instead of inferring a point from adjacent action buttons or toolbar icons.
- Expose structured safe-interior point-selection and occlusion recovery metadata to MCP Hosts.
- Stop coordinate retries from typing through dialogs, sheets, or other overlays; require a fresh non-occluded screenshot before retry.

## 0.0.8

- Restore tray-only Windows applications through generic session-process discovery and opaque application tokens without leaking executable paths.
- Prioritize semantic observation, screenshot digest comparison, changed-region or local OCR, and only then explicit Host visual understanding.
- Suppress repeated visual-model calls when the screenshot digest is unchanged and expose the local OCR fallback in the same observation transaction.
- Treat empty OCR crops as valid observations instead of provider failures.
- Compress application state into `active`, `visible`, `recoverable`, or `installed` model-facing records without application-name keywords or regular expressions.
- Preserve the official Hub card branding and link project discovery to the Xiaozhi Agent release page.

## 0.0.7

- Add a versioned capability handshake so the Host can inspect lifecycle, observation, action, delivery, and security support without expanding the Agent tool surface.
- Report focused controls, observation truncation, native-to-image scaling, action execution paths, delivery modes, and explicit fallback reasons.
- Bind desktop-control leases to the requesting Host session while allowing safe renewal by the same session.
- Keep the public Agent surface at four tools and preserve Host-only health, diagnostics, installation, and repair settings.
- Add a tag-verified Windows x64 GitHub Release workflow with immutable SEA artifacts, SHA-256 checksums, and Latest release promotion.
- Refresh the project story, installation guide, contribution workflow, and visual identity.

## 0.0.6

- Deliver owned screenshots as secure MCP image content and compact Markdown without exposing temporary local paths.
- Add verified foreground activation, tray application restore, screenshot-bound coordinate contracts, focus receipts, and explicit interaction intent.
- Add incremental native Unicode input and clipboard transaction modes for reliable Chinese text entry and live search controls.
- Keep OCR as the low-latency text path while requiring screenshot or visual grounding for editable interiors and complex layouts.
- Treat indeterminate mutations as non-replayable outcomes that require a fresh observation, and always release Computer Use state after completion or failure.
- Harden Windows SEA assembly by acquiring hash-locked assets explicitly in CI and pruning all non-Windows-x64 ONNX native targets.

## 0.0.5

- Preserve fresh OCR and screenshot observations so their bounded coordinates and high-confidence text tokens can be used by `computer.act`.
- Add observation-grounded `click`, `type_text`, and `press_key` actions with background delivery and supported foreground escalation.
- Keep coordinate actions bound to the active controller, exact observation id, capture bounds, and a 30-second action window that covers a real Agent reasoning turn.
- Update the real desktop MCP lifecycle gate to the consolidated acquire, observe, act, and release surface.

## 0.0.4

- Consolidate the Agent-facing desktop surface into `computer.acquire`, `computer.observe`, `computer.act`, and `computer.release`.
- Keep health, doctor, installation, and repair available to the Host as explicitly marked management tools instead of projecting them to the Agent.
- Preserve strict output schemas, approval, cancellation, cleanup, and safe repair planning across the consolidated contract.

## 0.0.3

- Discover the real foreground window from cua-driver z-order without requiring a guessed title.
- Accept `target: "foreground"`, exact window ids, case-insensitive titles, and the legacy `titlePart: "*"` foreground alias.
- Return structured, retryable window-resolution errors and normalized PowerShell CLIXML while keeping the MCP session usable after a failed tool call.

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
