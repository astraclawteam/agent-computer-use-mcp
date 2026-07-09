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
npm run phase:5.0
npm run phase:5.1
npm run phase:5.2
npm run phase:5.3
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
- `npm run phase:5.0` verifies concurrent `request_access` calls cannot create multiple active controllers.
- `npm run phase:5.1` verifies two standard MCP SDK clients can connect and call read-only tools concurrently.
- `npm run phase:5.2` verifies disconnect cleanup revokes active control state and stops overlay.
- `npm run phase:5.3` verifies all public MCP tools declare versioned strict output schemas through `tools/list`.
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
- Concurrent tool call report from `npm run phase:5.0`.
- Multi-client connection report from `npm run phase:5.1`.
- Disconnect cleanup report from `npm run phase:5.2`.
- Strict output schema report from `npm run phase:5.3`.
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
