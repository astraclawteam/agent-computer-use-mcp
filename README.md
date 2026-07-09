# agent-computer-use-mcp

`agent-computer-use-mcp` is a local Model Context Protocol server for Gateway-managed computer use. It exposes a stable `computer.*` tool surface while keeping desktop control, OCR, and user-visible safety affordances inside the local host.

The current implementation validates the product path used by the XiaozhiClaw Gateway work:

- standard MCP server/client paths through `@modelcontextprotocol/sdk`
- `cua-driver mcp` as the desktop action backend
- semantic capture, `set_value`, and background click actions
- user-only desktop overlay and cursor rendering
- OCR sidecar experiments with ONNX Runtime and PP-OCR model packs
- standalone client installation config for Codex and Claude Desktop style MCP clients

## Install

```sh
npm install
npm test
```

Run the MCP server over stdio:

```sh
npm run mcp
```

Example MCP client config:

```json
{
  "mcpServers": {
    "agent-computer-use": {
      "command": "node",
      "args": ["src/computer-use-mcp-server.mjs"],
      "cwd": "/path/to/agent-computer-use-mcp",
      "env": {
        "AGENT_COMPUTER_USE_ARTIFACT_ROOT": "/path/to/artifacts",
        "AGENT_COMPUTER_USE_OCR_MODEL_ROOT": "/path/to/models",
        "AGENT_COMPUTER_USE_CUA_DRIVER": "/path/to/cua-driver"
      }
    }
  }
}
```

## Useful Scripts

- `npm test`: run the full local test suite.
- `npm run phase:0.10`: verify release metadata, tag policy, changelog entry, and required release artifact commands.
- `npm run phase:0.11`: verify the alpha release readiness command manifest, required evidence, and release blockers.
- `npm run phase:0.12`: verify release artifact hashes and Windows helper signing evidence.
- `npm run phase:1.6`: print the local MCP install/config contract.
- `npm run phase:1.7`: verify a standalone official MCP SDK client can connect.
- `npm run phase:1.8`: verify the server path uses the official MCP SDK transport.
- `npm run phase:1.9`: verify permission tiers, unsafe-window deny policy, and secure-field fail-closed behavior.
- `npm run phase:1.10`: verify controller lease timeout cleanup stops overlay and blocks stale actions.
- `npm run phase:1.11`: verify commercial policy-deny proof for password, payment, credential, and private surfaces.
- `npm run phase:1.12`: verify computer control approval, deny, cancel, revoke, and timeout state transitions.
- `npm run phase:2.0`: verify `computer.doctor` over the official MCP SDK without starting desktop control.
- `npm run phase:2.1`: verify `computer.repair` remains approval-gated and plan-only by default.
- `npm run phase:2.2`: verify repair approval tokens expire and revoke clears pending approval state.
- `npm run phase:2.3`: verify trace/log/artifact roots and diagnostics redaction policy.
- `npm run phase:2.4`: verify the redacted JSONL trace writer rejects screenshot and overlay payloads.
- `npm run phase:2.5`: verify diagnostics retention cleanup deletes only expired trace/log/artifact files.
- `npm run phase:2.6`: verify daemon lifecycle lock acquisition, duplicate startup detection, stale lock recovery, and release cleanup.
- `npm run phase:2.7`: verify child process supervision reports crashes as degraded state and plans approved restarts.
- `npm run phase:2.8`: verify supervisor crash recovery appears in `computer.doctor` and executes through approval-gated `computer.repair`.
- `npm run phase:2.9`: verify repair approval denial clears pending state and never executes repair actions.
- `npm run phase:2.10`: verify daemon session lock ownership, duplicate startup blocking, child supervision, recovery, and clean shutdown.
- `npm run phase:2.11`: verify daemon session health and approved recovery surface through `computer.doctor` and `computer.repair`.
- `npm run phase:2.12`: verify stale daemon locks and expired runtime temp files are cleaned without starting desktop control.
- `npm run phase:3.0`: verify the OCR model pack manifest and file-level doctor contract.
- `npm run phase:3.1`: verify dirty-region OCR scheduling, cache keys, and full-window OCR gating for action loops.
- `npm run phase:3.2`: verify local template matching for static/repeated controls and pixel-limited observation output.
- `npm run phase:3.3`: verify local SOM proposal generation for self-drawn/canvas surfaces without image upload.
- `npm run phase:3.4`: verify per-region perception strategy selection from UIA/SOM to OCR, template/CV, SOM proposal, and explicit VLM fallback.
- `npm run phase:4.0`: verify overlay placement planning for multi-display, high DPI, fullscreen/borderless, and unavailable target windows.
- `npm run phase:4.1`: verify overlay theme adaptation and shared brand cursor style tokens.
- `npm run phase:4.2`: verify overlay target tracking for moved, hidden, occluded, and cross-display windows.
- `npm run phase:4.3`: verify overlay exclusion from capture, OCR, trace, and artifact paths.
- `npm run phase:5.0`: verify concurrent `request_access` calls cannot create multiple active controllers.
- `npm run phase:5.1`: verify two standard MCP SDK clients can connect and call read-only tools concurrently.
- `npm run phase:5.2`: verify disconnect cleanup revokes active control state and stops overlay.
- `npm run phase:5.3`: verify every public MCP tool declares a versioned strict output schema.
- `npm run phase:5.4`: verify MCP Inspector-style initialization, tool listing, and read-only tool calls.
- `npm run phase:5.5`: verify pending approval schema compatibility, duplicate-pending rejection, and disconnect cleanup.
- `npm run phase:6.0`: verify the product app smoke matrix uses the release result schema and required category coverage.
- `npm run phase:6.1`: verify the app smoke matrix has 20-50 commercial beta coverage rows and fail-closed audit notes.
- `npm run phase:7.0`: verify first-run readiness keeps setup plan-only, offline-capable, and progress-aware.
- `npm run phase:7.1`: verify offline bundle readiness fail-closes before first enable when required cache metadata is missing.
- `npm run phase:7.2`: verify repair progress plans make long setup operations approval-gated, cancellable, and no-download by default.
- `npm run phase:7.3`: verify offline bundle capability proof covers health, overlay, semantic capture, and configured model-pack OCR without network.
- `npm run phase:7.4`: verify offline install proof covers install roots, prepared bundle, and offline capabilities without network or first-enable downloads.
- `npm run phase:1.4`: run the real `cua-driver mcp` desktop action lifecycle smoke.
- `npm run package:foundation`: print install layout, version policy, packaging policy, and offline asset manifest.
- `npm run package:dry-run`: run `npm pack --dry-run --json` and fail if generated artifacts would enter the package.
- `npm run assets:manifest`: print the offline asset manifest.
- `npm run doctor:install-cache`: inspect local driver, overlay, OCR runtime/model, WebView2, and permission readiness without starting desktop control.
- `npm run release:readiness`: print the Phase 0.11 release readiness manifest validation report.
- `npm run release:artifacts`: print the Phase 0.12 release artifact hash and signing verification report.

## Environment

Preferred public environment variables:

- `AGENT_COMPUTER_USE_CUA_DRIVER`
- `AGENT_COMPUTER_USE_CUA_DRIVER_PATH`
- `AGENT_COMPUTER_USE_ARTIFACT_ROOT`
- `AGENT_COMPUTER_USE_OCR_MODEL_ROOT`
- `AGENT_COMPUTER_USE_OCR_MODEL_DIR`
- `AGENT_COMPUTER_USE_OVERLAY_DISABLED`
- `AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE`

Legacy `XIAOZHICLAW_*` variables are still accepted for compatibility with the original Gateway prototype.

## Safety Model

The overlay is a user-only affordance. It must be visible while Gateway-managed computer use is active, but it is never included in agent observations, screenshots, OCR input, or benchmark artifacts.

The MCP module does not disable or restrict native computer-use capabilities provided by third-party agents. Gateway-managed actions and agent-native actions should be reported separately by host products.

## Productization

Commercial-readiness planning lives in:

- `docs/productization/roadmap.md`
- `docs/productization/release-gates.md`
- `docs/productization/app-smoke-matrix.md`

New productization work should use the GitHub issue templates for productization phases and app smokes.
