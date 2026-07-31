# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.22

- Declare post-write `focusReceipt` and `mutationVerification` fields in the strict observation output schema.
- Cover the real MCP result envelope so a recovered focus receipt cannot be rejected as an additional property.

## 0.0.21

- Preserve safe keyboard continuation after coordinate Unicode input when a fresh same-window observation confirms the exact value near the grounded target.
- Return the recovered short-lived focus receipt on that observation so an Agent can commit live search or message input without another guessed click.
- Keep uncertain writes fail-closed when the exact post-action value or surface identity cannot be confirmed.

## 0.0.20

- Fail closed before acquire, observation, or action when the Windows input desktop is locked or secure.
- Bind each observation to a single-use surface receipt and require a fresh observation after every action.
- Reject screenshot surfaces whose reported native window identity differs from the acquired target.
- Apply screenshot-pixel to native-window scaling inside the Host instead of asking the Agent to transform coordinates.

## 0.0.19

- Restrict tray accessibility discovery to notification icon elements instead of traversing every desktop button.
- Give the bounded native tray bridge enough time to complete on control-dense desktops.
- Prevent a slow but valid tray restoration from falling through to duplicate application launch.

## 0.0.18

- Prefer an opaque application token over a redundant title hint left from an earlier window lookup.
- Keep target and explicit window selectors mutually exclusive with application restoration.
- Prevent recoverable tray workflows from terminating on harmless Agent argument carry-over.

## 0.0.17

- Enrich running-process application identities from exact Windows Start Menu shortcut targets.
- Preserve non-ASCII display identities with explicit UTF-8 probe output.
- Let tray restoration match localized system identities without fuzzy matching or application-specific rules.

## 0.0.16

- Restore an already-running tray application through its exact system accessibility identity before launching an executable.
- Preserve the discovered application display identity through the opaque application-token acquire path.
- Prevent tray-only applications from being replaced by duplicate launcher windows when the original process can be restored.

## 0.0.15

- Preserve the active Host request context across action verification observations.
- Keep semantic clicks, text actions, key presses, and activation follow-up captures on the acquiring session lease.
- Prevent correctly delivered desktop actions from being misreported as another Host session's controller.

## 0.0.14

- Wait for bounded asynchronous screenshot handoff before projecting secure MCP image content.
- Retry missing and partially written PNG assets without exposing connector-private file paths.
- Prevent real desktop screenshot observations from failing with transient `ENOENT` errors.
- Restore an existing hidden or off-screen process window before falling back to launching another application instance.

## 0.0.13

- Keep semantic observations, screenshots, and actions bound to the acquired native window handle.
- Ignore transient same-process auxiliary-window identity and off-screen bounds returned after activation.
- Prevent focus and coordinate drift when the captured primary surface differs from an auxiliary provider window.
- Keep the self-contained overlay single-file package uncompressed so first-run startup remains within the product latency budget.

## 0.0.12

- Prefer the bounded primary application surface when one process exposes same-title auxiliary windows.
- Keep screenshot-backed OCR coordinates in the exact observation pixel space consumed by actions.
- Preserve exact explicit-window selection while making tray restoration and natural-language targeting more reliable.

## 0.0.11

- Keep bounded OCR baseline and changed-region routing metadata valid under the strict MCP output schema.
- Let one Host session safely reuse or retarget its active controller without requiring the Agent to repeat an identity field.
- Preserve fail-closed controller isolation across owners, agents, projects, and sessions.

## 0.0.10

- Retry a missing full-window OCR baseline once when the first screenshot arrived before the local sidecar was ready.
- Preserve static dialogs and overlays in structured observation instead of losing them to later changed-region-only scans.
- Return immediately to changed-region and local-crop-first routing after the bounded baseline succeeds.

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
