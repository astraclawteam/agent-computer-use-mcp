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
npm run phase:2.0
npm run phase:2.1
npm run phase:2.2
npm run phase:2.3
npm run phase:2.4
npm run phase:2.5
npm run phase:2.6
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
- `npm run phase:2.3` records trace/log/artifact roots and verifies diagnostics redaction.
- `npm run phase:2.4` verifies redacted JSONL trace output and blocks screenshot/overlay payloads.
- `npm run phase:2.5` verifies retention cleanup only deletes expired trace/log/artifact files.
- `npm run phase:2.6` verifies daemon lifecycle locking, duplicate startup handling, stale lock recovery, and shutdown cleanup.
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
