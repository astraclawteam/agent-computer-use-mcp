# Productization Roadmap

This roadmap turns the current MVP into a commercial local MCP module. It is written for a large human/AI maintenance team: each phase has a clear deliverable, explicit non-goals, and verification gates.

## Current Baseline

- Standard MCP server and clients use `@modelcontextprotocol/sdk@1.29.0`.
- `agent-computer-use-mcp` exposes `computer.*` tools over stdio.
- Real desktop action lifecycle is validated against `NativeComputerUseLab`.
- `cua-driver mcp` is the current desktop action backend.
- Gateway-managed overlay, target-window frame, and branded cursor are validated.
- OCR sidecar has an MVP path, but model pack management and production scheduling are not complete.

## Phase P0: Package Foundation

Goal: make the repository installable, upgradeable, and supportable as a real package.

Deliverables:

- Fixed package layout and public entry points.
- Versioning policy and changelog.
- Stable install roots:
  - Windows data: `%LOCALAPPDATA%\AgentComputerUse`
  - Windows program cache: `%LOCALAPPDATA%\Programs\AgentComputerUse`
  - Unix data: `$XDG_DATA_HOME/agent-computer-use` or `~/.local/share/agent-computer-use`
- Installer/cache strategy for `cua-driver`, overlay shell, OCR runtime, and OCR model packs.
- Release artifact policy for online and offline installs.
- Code signing policy for Windows helper binaries.

Acceptance:

- `npm pack --dry-run` contains only intended files.
- `npm run package:foundation` emits install layout, version policy, signing placeholders, package file policy, and offline asset manifest.
- `npm run assets:manifest` emits a standalone offline asset manifest.
- `npm run doctor:install-cache` emits a plan-only readiness report for driver, overlay, OCR runtime/model, WebView2, and permissions without starting desktop control.
- `npm run phase:1.6` emits install paths using `AGENT_COMPUTER_USE_*`.
- A clean Windows VM can install, run `computer.health({fast:true})`, and produce a clear degraded state when optional assets are missing.

Non-goals:

- No new perception algorithm work.
- No main host integration work.

## Phase P1: Permission And Policy Engine

Goal: make actions safe enough for third-party agents and unattended local runs.

Deliverables:

- Permission tiers:
  - `observe`: semantic capture, OCR, diff, health, no state-changing action.
  - `full`: allowed element actions in approved windows/apps.
  - `admin`: explicitly approved high-risk flows; disabled by default.
- Action allowlist and denylist.
- Window/app deny policies for password managers, payment flows, private documents, OS security prompts, credential dialogs, and browser private windows.
- Field-level protection for password/secure text boxes.
- Approval state machine for approve, deny, cancel, revoke, and timeout.
- Reliable cleanup when approval or action is interrupted.

Acceptance:

- Policy unit tests cover allow, deny, tier downgrade, timeout, revoke, and stale controller cleanup.
- `computer.act` fails closed for unknown action kinds.
- Password fields cannot be read or written without an explicit future high-risk flow.

## Phase P2: Stable Runtime

Goal: make the daemon boring: predictable startup, shutdown, diagnostics, and recovery.

Deliverables:

- MCP daemon lifecycle manager.
- Duplicate startup handling.
- Crash recovery for `cua-driver mcp`, overlay shell, OCR sidecar, and native helper apps.
- Process and temp-file cleanup.
- `computer.doctor` and `computer.repair` tools.
- Trace/log/artifact directory spec.
- Redaction policy for logs and artifacts.

Acceptance:

- Killing overlay/OCR/driver child processes during a test produces a structured degraded state and recoverable next action.
- `computer.doctor` returns actionable results without starting desktop control.
- `computer.repair` never performs high-risk installs or downloads without explicit approval.

## Phase P3: Perception Hardening

Goal: cover UIA/SOM gaps without forcing every task through screenshot-to-VLM loops.

Deliverables:

- OCR model pack manager.
- OCR region cache and diff scheduler.
- Local crop bucketing for stable ONNX Runtime latency.
- Template matching provider for static icons and repeated UI controls.
- SOM proposal provider for self-drawn, canvas, Qt, industrial, and editor surfaces.
- Per-region strategy selection: UIA/SOM first, OCR second, template/CV third, optional VLM last.

Acceptance:

- Small UI crop warm p95 stays within 50-200ms.
- Ordinary window region warm p95 stays within 300ms.
- Full-window OCR is not used in normal action loops.
- Self-drawn/canvas fixture produces actionable observations without image upload.

## Phase P4: Commercial Overlay

Goal: make the user-visible active-control affordance robust across real desktops.

Deliverables:

- Multi-display support.
- High DPI scaling.
- Fullscreen and borderless window behavior.
- Minimized, hidden, occluded, and moved-window tracking.
- Theme adaptation for light/dark/high contrast.
- Cursor rendering lifecycle and style tokens.
- Overlay exclusion from capture, OCR, observation, logs, and persisted artifacts.

Acceptance:

- Overlay remains click-through and 8-16px visible thickness on all tested DPI scales.
- Overlay follows target window across displays.
- `includeUserOverlay=false` is preserved in every capture path.

## Phase P5: MCP Compatibility

Goal: prove that standard MCP clients can use the package reliably.

Deliverables:

- MCP Inspector smoke tests.
- Multi-client connection tests.
- Abnormal disconnect tests.
- Concurrent tool call tests.
- Strict tool input/output schemas.
- Backward-compatible versioned result contracts.

Acceptance:

- Inspector can initialize, list tools, and call read-only tools.
- Concurrent calls cannot corrupt controller state.
- Disconnect during active control triggers timeout/revoke cleanup.

## Phase P6: Real Software Matrix

Goal: move from lab validation to broad local application confidence.

Deliverables:

- 20-50 representative local app smoke tests.
- Required app categories:
  - Notepad/basic Win32
  - browser
  - Electron
  - WPF
  - WinForms
  - Qt
  - Office/editor
  - terminal
  - canvas/self-drawn UI
  - industrial/CAD-like surface
- Repeatable test harness and result schema.

Acceptance:

- Each app smoke declares capability source: UIA/SOM, OCR, template, CV, or insufficient.
- Failures produce `observation.insufficient` or structured policy errors, not guessed coordinates.

## Phase P7: Install Experience

Goal: first use should feel intentional, offline-capable, and repairable.

Deliverables:

- First-run doctor.
- Asset cache manifest.
- Offline bundle policy.
- Clear repair entry points for missing `cua-driver`, OCR model pack, WebView2, permissions, and OS features.
- Progress reporting for long operations.

Acceptance:

- First enable does not block indefinitely on downloads.
- Missing optional components show exact repair actions.
- The install/cache doctor remains plan-only until the host receives explicit user approval.
- Offline bundle can run `health`, overlay, semantic capture, and configured model-pack OCR without network.

## Release Gates

See `docs/productization/release-gates.md`.
