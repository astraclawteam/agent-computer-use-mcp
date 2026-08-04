# Productization Roadmap

## Agent E2E Status

Phase 6.2 is application harness evidence, not Agent E2E qualification. Its
scripted adapters and mocks cannot qualify an installed application. All
installed applications remain `unqualified` until real Codex, Claude Desktop,
and both Xiaozhi Claw model lanes produce matching sealed Phase 10 evidence.

The four-lane contract, environment-only adapter boundary, canonical task pack,
retry rules, seven-file privacy-safe evidence schema, and `3/3` aggregation
survive in `src/agent-e2e/`. The campaign driver and host discovery runners
(`phase-10-2`, `phase-10-3`, `phase-10-4`) were removed by `11c7fc6`, so no
qualification run can currently be executed at all — that is a stronger blocker
than the previously recorded one, which was only that no `qualification-host-v1`
session bridge is configured for any lane. Contract tests and fake bridge tests
set `qualificationClaim: false` and do not count as Agent E2E evidence.

## PR7A Evidence Status

The adapter lifecycle and privacy-only policy boundary survive in
`src/app-adapters/`. The schema-v2 real application runner, sealed evidence
output, matrix renderer, and the later orphaned matrix helper are absent and
must be rebuilt as one coherent evidence pipeline. Commercial application
coverage is therefore blocked twice over: no runner exists, and the hash-locked
fixture pack has never been published. Local development failures remain
visible and are not release pass claims.

## Complete

- Standard MCP server/client package and strict tool schemas.
- Gateway-managed control lifecycle, policy tiers, approvals, cancellation, revocation, timeout, and overlay cleanup.
- UIA/SOM-first observation, local PP-OCRv6 ONNX sidecar, region/diff scheduling, template matching, and local SOM proposals.
- Native layered overlay and branded cursor with observation exclusion.
- Daemon lifecycle, disconnect cleanup, concurrency gates, and bounded runtime soak.
- Self-contained Windows x64 SEA artifact with immutable SHA-256 inventory,
  licenses, checksums, and SBOM.
- Official MCP SDK offline smoke with no system Node, npm, startup network,
  elevation, or self-update.
- Tag-only GitHub Release workflow that verifies version, main ancestry,
  changelog, tests, packaging, and exact source identity before publishing.
- Hash-verified quick/full perception corpus contracts, privacy scanner, and
  deterministic regression extraction.
- Shared UI OCR normalization, content-addressed bounded region cache, and
  calibrated SOM/OCR/template proposal fusion with provenance-aware action
  admission.
- Protocol-layer tool surfaces: `tools/list` and `tools/call` both restrict a
  default launch to `computer.task` and `computer.message`, so a third-party MCP
  Host enforces the Host-only boundary without reading a private `_meta` key.

## Withdrawn With The SEA Convergence

`11c7fc6` (2026-07-21) removed the npm/platform-package distribution path and,
with it, every evidence runner that depended on that pipeline. The retired
runners below remain removed. Their documents describe the former pipelines
and are not evidence that those pipelines ran. Phase 6 now has a separate
optional source-bound qualification-evidence verifier; it does not revive or
imply the former real-application matrix runner and is not invoked by every
preview tag:

| Gate | Removed runner | Doc still describing it |
| --- | --- | --- |
| PR / nightly / RC runtime soak | `src/phase-8-0-runtime-soak.mjs`, `src/runtime-soak-*.mjs`, `src/commercial-evidence*.mjs`, `.github/workflows/nightly-soak.yml` | `runtime-soak-operations.md` |
| Real application smoke matrix | `src/phase-6-0/6-1/6-2-*.mjs`, `src/real-app-smoke-runner.mjs`, `src/real-app-catalog.mjs`, `src/app-fixture-pack.mjs`, `scripts/render-app-smoke-matrix.mjs`, `.github/workflows/real-app-smoke.yml` | `app-smoke-matrix.md` |
| Perception corpus generation | `scripts/generate-quick-perception-corpus.mjs`, `.github/workflows/nightly-perception.yml` | this file |
| Agent E2E qualification campaign | `src/phase-10-2-host-discovery.mjs`, `src/phase-10-3-agent-e2e-campaign.mjs`, `src/phase-10-4-agent-e2e-evidence.mjs` | this file |
| Commercial 1.0 promotion | `src/phase-9-0-commercial-promotion.mjs`, `src/commercial-promotion.mjs` | `release-gates.md` |

`npm run soak:pr`, `npm run soak:rc`, `npm run phase:8.0`, `npm run evidence:verify`,
and `npm run soak:rc:verify` are referenced by those documents but are not
defined in `package.json`. The surviving pieces are the contract and evidence
schemas (`src/agent-e2e/*`, `src/perception-corpus.mjs`,
`src/phase-6-staged-acceptance.mjs`). The current optional Phase 6
qualification path is
`src/phase-6-release-evidence.mjs` plus
`scripts/verify-phase-6-release-evidence.mjs`.

## Before Public 1.0

Every item below is now gated behind rebuilding a runner listed in **Withdrawn
With The SEA Convergence**. Ordering matters: rebuild the runner, prove it on a
prepared Windows machine, then collect evidence. No item can be closed by a
document edit.

- Complete Phase 6 staged real-application acceptance before making a formal
  public-readiness claim. Qualification is read only from a sealed
  `release-evidence/phase-6.json` that passes
  `npm run verify:phase-6:release-evidence`; this roadmap does not duplicate a
  mutable ladder score. Preview tags remain operator-decided and do not force
  this campaign. Levels 1 to 4 require a real logged-in WeChat and a designated
  test contact, because a passing attempt sends a real message and is scored on
  zero mis-sends.
- Expand real app evidence across Office, Electron, Qt, WPF, Canvas, self-drawn, editing, and industrial software.
- Collect and retain passing two-hour nightly and eight-hour release-candidate
  evidence on prepared Windows runners. The PR6B mechanism was removed with the
  SEA convergence and must be rebuilt before any long run can start.
- Run clean-runner release rehearsals and retain failed evidence beside passing retries.
- Retain clean install evidence for every published Windows x64 preview.
- Evaluate additional mirrors only as separately authorized transports of the
  exact GitHub Release bytes.
- Continue OCR screenshot regression and warm region latency tracking.
- Publish and lock the external full corpus (at least 400 OCR and 200 visual
  samples), then retain passing full-corpus results from the app-lab runner.
- Regenerate PR6/PR7 evidence with the unified candidate identity required by
  Phase 9.0; historical evidence without that identity remains intentionally
  ineligible.

## Future Platforms

macOS and Linux artifacts remain unpublished. Each platform needs a real
driver, overlay, OCR runtime, permission model, packaging, offline execution,
and app-matrix validation before release.
## Preview Browser Boundary

- The public MCP remains OS-only and contains no built-in browser/CDP kernel.
- `PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment.
- Gateway-managed components MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel.
- XiaozhiClaw built-in Preview Browser actions always use the host semantic provider and never receive a raw CDP endpoint.
- Explicit physical control of a built-in preview must use canonical OS tokens and the host's shared target lease.
- Third-party agent-native capabilities remain outside Gateway enforcement; agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement.
- End-to-end agent-native routing is a host-owned invariant; the host runtime, rather than this OS MCP package, owns its executable bypass test.
