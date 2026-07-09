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
- `npm run phase:1.6`: print the local MCP install/config contract.
- `npm run phase:1.7`: verify a standalone official MCP SDK client can connect.
- `npm run phase:1.8`: verify the server path uses the official MCP SDK transport.
- `npm run phase:2.0`: verify `computer.doctor` over the official MCP SDK without starting desktop control.
- `npm run phase:2.1`: verify `computer.repair` remains approval-gated and plan-only by default.
- `npm run phase:2.2`: verify repair approval tokens expire and revoke clears pending approval state.
- `npm run phase:2.3`: verify trace/log/artifact roots and diagnostics redaction policy.
- `npm run phase:2.4`: verify the redacted JSONL trace writer rejects screenshot and overlay payloads.
- `npm run phase:2.5`: verify diagnostics retention cleanup deletes only expired trace/log/artifact files.
- `npm run phase:2.6`: verify daemon lifecycle lock acquisition, duplicate startup detection, stale lock recovery, and release cleanup.
- `npm run phase:2.7`: verify child process supervision reports crashes as degraded state and plans approved restarts.
- `npm run phase:1.4`: run the real `cua-driver mcp` desktop action lifecycle smoke.
- `npm run package:foundation`: print install layout, version policy, packaging policy, and offline asset manifest.
- `npm run package:dry-run`: run `npm pack --dry-run --json` and fail if generated artifacts would enter the package.
- `npm run assets:manifest`: print the offline asset manifest.
- `npm run doctor:install-cache`: inspect local driver, overlay, OCR runtime/model, WebView2, and permission readiness without starting desktop control.

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
