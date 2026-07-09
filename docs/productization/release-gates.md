# Release Gates

Commercial releases must pass these gates before tagging.

## Alpha Gate

Scope:

- Package foundation.
- Permission tiers.
- Doctor/health basics.
- Native Lab and Notepad validation.

Required commands:

```sh
npm test
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
npm run phase:1.9
npm run phase:1.10
npm run phase:2.0
npm run phase:2.1
npm run phase:2.2
npm run phase:2.3
npm run phase:2.4
npm run phase:2.5
npm run phase:2.6
npm run phase:2.7
npm run phase:2.8
npm run phase:2.9
npm run phase:3.0
npm run phase:3.1
npm run phase:3.2
npm run phase:3.3
npm run phase:3.4
npm run phase:4.0
npm run phase:4.1
npm run phase:4.2
npm run phase:4.3
npm run phase:5.0
npm run phase:5.1
npm run phase:5.2
npm run phase:5.3
npm run phase:5.4
npm run phase:6.0
npm run phase:6.1
npm run phase:7.0
npm run phase:7.1
npm run phase:1.4
npm run package:foundation
npm run package:dry-run
npm run assets:manifest
npm run doctor:install-cache
```

Required evidence:

- `npm run package:dry-run` passes with no generated artifacts.
- `npm run package:foundation` records install layout, version policy, and package file policy.
- `npm run assets:manifest` records offline/cacheable asset packs.
- `npm run doctor:install-cache` records readiness and repair actions without starting desktop control.
- `npm run phase:1.9` verifies permission tiers, unsafe-window deny policy, and secure-field fail-closed behavior.
- `npm run phase:1.10` verifies controller lease timeout cleanup stops overlay and blocks stale actions.
- `npm run phase:2.3` records trace/log/artifact roots and verifies diagnostics redaction.
- `npm run phase:2.4` verifies redacted JSONL trace output and blocks screenshot/overlay payloads.
- `npm run phase:2.5` verifies retention cleanup only deletes expired trace/log/artifact files.
- `npm run phase:2.6` verifies daemon lifecycle locking, duplicate startup handling, stale lock recovery, and shutdown cleanup.
- `npm run phase:2.7` verifies child process crash detection produces structured degraded state and approval-gated restart actions.
- `npm run phase:2.8` verifies child process recovery actions surface through `computer.doctor` and approval-gated `computer.repair`.
- `npm run phase:2.9` verifies repair approval denial clears pending state and never executes repair actions.
- `npm run phase:3.0` verifies OCR model pack manifest and file-level doctor readiness without downloads or desktop control.
- `npm run phase:3.1` verifies dirty-region OCR scheduling, stable region cache keys, and normal action-loop full-window OCR gating.
- `npm run phase:3.2` verifies local template matching for static/repeated controls and pixel-limited observation output.
- `npm run phase:3.3` verifies local SOM proposal generation for self-drawn/canvas surfaces without image upload.
- `npm run phase:3.4` verifies per-region perception strategy selection keeps UIA/SOM first, OCR second, template/CV and SOM proposal third, and VLM explicit-only.
- `npm run phase:4.0` verifies overlay placement planning for multi-display, high DPI, fullscreen/borderless, and unavailable target windows.
- `npm run phase:4.1` verifies overlay theme adaptation and shared brand cursor style tokens.
- `npm run phase:4.2` verifies overlay target tracking for moved, hidden, occluded, and cross-display windows.
- `npm run phase:4.3` verifies overlay exclusion from capture, OCR, trace, and artifact paths.
- `npm run phase:5.0` verifies concurrent `request_access` calls cannot create multiple active controllers.
- `npm run phase:5.1` verifies two standard MCP SDK clients can connect and call read-only tools concurrently.
- `npm run phase:5.2` verifies disconnect cleanup revokes active control state and stops overlay.
- `npm run phase:5.3` verifies all public MCP tools declare versioned strict output schemas through `tools/list`.
- `npm run phase:5.4` verifies MCP Inspector-style initialization, tool listing, and read-only tool calls.
- `npm run phase:6.0` verifies the app smoke matrix result schema and required category coverage.
- `npm run phase:6.1` verifies the app smoke matrix has 20-50 commercial beta coverage rows and fail-closed audit notes.
- `npm run phase:7.0` verifies first-run readiness keeps setup plan-only, offline-capable, and progress-aware.
- `npm run phase:7.1` verifies offline bundle readiness fail-closes before first enable when required cache metadata is missing.
- No generated build output or model packs in Git.
- `computer.health({fast:true})` is ready or structured degraded.
- User overlay is excluded from observations.

## Beta Gate

Scope:

- Runtime recovery.
- OCR model pack manager.
- Region/diff OCR scheduler.
- 10+ app smoke tests.
- MCP Inspector compatibility.

Required evidence:

- Crash recovery tests for overlay, OCR sidecar, and `cua-driver mcp`.
- `computer.doctor` and `computer.repair` smoke outputs.
- OCR model pack manager report from `npm run phase:3.0`.
- OCR region/diff scheduler report from `npm run phase:3.1`.
- Template matching provider report from `npm run phase:3.2`.
- SOM proposal provider report from `npm run phase:3.3`.
- Per-region strategy selector report from `npm run phase:3.4`.
- Overlay placement planner report from `npm run phase:4.0`.
- Overlay theme and cursor token report from `npm run phase:4.1`.
- Overlay target tracker report from `npm run phase:4.2`.
- Overlay exclusion policy report from `npm run phase:4.3`.
- Concurrent tool call report from `npm run phase:5.0`.
- Multi-client connection report from `npm run phase:5.1`.
- Disconnect cleanup report from `npm run phase:5.2`.
- Strict output schema report from `npm run phase:5.3`.
- MCP Inspector smoke report from `npm run phase:5.4`.
- App smoke matrix contract report from `npm run phase:6.0`.
- App smoke coverage report from `npm run phase:6.1`.
- First-run readiness report from `npm run phase:7.0`.
- Offline bundle readiness report from `npm run phase:7.1`.
- OCR latency report with warm p95 values.
- App matrix report in `docs/productization/app-smoke-matrix.md`.

## Commercial Gate

Scope:

- Signed Windows helpers.
- Offline bundle.
- 20-50 app smoke matrix.
- Strict MCP schemas and multi-client stress tests.
- Complete permission/policy engine.

Required evidence:

- Release artifact hashes.
- Signing verification output.
- Offline install proof.
- Policy-deny proof for password/payment/private surfaces.
- Concurrency and disconnect test reports.
- Human review of public MCP contract changes.

## Blockers

Any of these block release:

- Overlay appears in agent observations, OCR input, screenshots, or artifacts.
- Unknown action kind executes instead of failing closed.
- Password or credential field is readable/writable through normal tiers.
- Full-window OCR becomes the default action loop.
- `main` receives non-admin direct pushes after branch protection is enabled.
- CI required checks are bypassed for non-admin merges.
