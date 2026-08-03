<div align="center">

<img src="docs/assets/computer-use-hero.png" alt="Computer Use observes a protected desktop surface and turns grounded observations into safe actions" width="100%" />

# Computer Use MCP

### See the desktop. Understand the interface. Act with evidence.

[![Release](https://img.shields.io/github/v/release/astraclawteam/agent-computer-use-mcp?display_name=tag&sort=semver)](https://github.com/astraclawteam/agent-computer-use-mcp/releases/latest)
[![CI](https://github.com/astraclawteam/agent-computer-use-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/astraclawteam/agent-computer-use-mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-standard-5b5bd6)](https://modelcontextprotocol.io/)
[![Windows](https://img.shields.io/badge/Windows-x64-1674ea)](https://github.com/astraclawteam/agent-computer-use-mcp/releases/latest)
[![License](https://img.shields.io/github/license/astraclawteam/agent-computer-use-mcp)](LICENSE)

`agent-computer-use-mcp` gives an MCP Host a compact, observable way to operate
local Windows applications. It combines semantic accessibility, secure
screenshot delivery, local PP-OCRv6, reliable Unicode input, and explicit
action verification behind a session-bound control lease.

[Download the latest release](https://github.com/astraclawteam/agent-computer-use-mcp/releases/latest)
· [Read the changelog](CHANGELOG.md)
· [Contribute](CONTRIBUTING.md)

</div>

> **Preview:** `0.x` targets Windows x64 and is evolving quickly. Actions remain
> Host-approved, application-visible, and fail closed when evidence is
> insufficient.

## From intent to verified action

```text
Natural-language task
        ↓
Host selects Computer Use from its semantic capability description
        ↓
Acquire a session-bound desktop control lease
        ↓
Observe: accessibility first → OCR → secure image understanding when needed
        ↓
Act through a semantic element, focus receipt, or observation-bound coordinate
        ↓
Verify the outcome and release control on success, failure, or cancellation
```

The Agent sees two task-level tools:

| Tool | Purpose |
| --- | --- |
| `computer.task` | Advance a generic non-messaging desktop goal through Host-owned observations and opaque semantic candidates; every invocation releases control before returning. |
| `computer.message` | Run the Host-owned deterministic messaging state machine; exact targets are resolved without exposing coordinate or lifecycle decisions to the Agent. |

The lifecycle tools (`computer.acquire`, `computer.observe`, `computer.act`,
and `computer.release`) are workflow-internal. Health, doctor, installation,
and repair are also Host-only. None are projected into the Agent's normal tool
inventory.

## Why this implementation

- **Semantic first, pixels when necessary.** Accessible controls are faster and
  more reliable than guessed coordinates. OCR handles low-latency text; image
  understanding is reserved for layouts, icons, and complex scenes.
- **Coordinates carry provenance.** Screenshot dimensions, native-window scale,
  truncation, focus, observation identity, and expiry travel with the result.
- **Actions prove their postconditions.** Navigation receipts expose the
  provider outcome and the newer Host Scene evidence that confirmed the target
  state, destination surface, or owned transient. Provider status alone cannot
  turn an unobserved click into success. When the first post-action Scene is
  inconclusive, the Host may perform one read-only related-surface capture; it
  never replays the click.
- **Chinese input is a first-class path.** Coordinate-grounded Unicode entry
  uses verified native delivery, while semantic fields remain on the driver
  path.
- **Screenshots are assets, not file paths.** The Host receives controlled MCP
  image content; the Agent never needs access to a temporary local file.
- **Control has a lifecycle.** Leases are bound to the requesting Host session
  and are revoked on completion, cancellation, timeout, disconnect, or process
  shutdown.
- **Task routing cannot escape the Host.** A generic task result limits the next
  interaction step to `computer.task`; shell, raw targeting, and lifecycle
  tools cannot replace an unresolved Host candidate. Same-package child
  processes inherit only their proven owning-window process identity. A
  navigation click whose Scene postcondition is not proven closes without
  replay, even if the provider reported delivery.
- **No hidden self-update.** Startup is offline. Installation, upgrade,
  downgrade, and rollback are explicit Host or operator actions.

## Install

### XiaozhiClaw

Open **Plugins → Connectors**, install **Computer Use**, review the requested
desktop permissions, and enable it. Health, diagnostics, installation details,
and repair planning are available from the connector's settings panel.

### Any standard MCP Host

Download `agent-computer-use-mcp-<version>-win32-x64.tar.gz` from the
[latest GitHub Release](https://github.com/astraclawteam/agent-computer-use-mcp/releases/latest),
verify it against `SHA256SUMS.txt`, and extract it. The executable is:

```text
artifact/bin/agent-computer-use-mcp.exe
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "computer-use": {
      "command": "C:\\Tools\\agent-computer-use-mcp\\artifact\\bin\\agent-computer-use-mcp.exe",
      "args": []
    }
  }
}
```

The release contains the exact Windows x64 driver, native overlay, ONNX runtime,
PP-OCRv6 model pack, inventory, checksums, licenses, and SBOM used by CI. It
requires no npm install and performs no network access at startup.

## Safety model

Computer Use is intentionally visible and bounded:

- the Host owns approval, process lifecycle, installation, and media assets;
- the Agent cannot acquire another Host session's lease;
- password, payment, credential, private, and denied-window policies fail closed;
- the branded frame and cursor are excluded from screenshots, OCR, observations,
  traces, and benchmark artifacts;
- uncertain mutations are never blindly replayed—they require a fresh observation;
- repair reports a plan and never downloads or installs implicitly.

## Develop

Requirements: Windows x64, Node.js 24, npm 11, and .NET 10 SDK.

```powershell
git clone https://github.com/astraclawteam/agent-computer-use-mcp.git
cd agent-computer-use-mcp
npm ci
npm test
npm run mcp
```

Protocol and packaging gates:

```powershell
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
npm run artifact:windows:build -- --allow-network
```

Real desktop action gate:

```powershell
npm run phase:1.4
```

The full test suite is deliberately serial. It covers MCP interoperability,
leases, policy, perception, Unicode delivery, cleanup races, overlay exclusion,
and immutable Windows artifact assembly.

## Release

A `vX.Y.Z` tag must match `package.json`, point to a commit reachable from
`main`, and have a matching `CHANGELOG.md` section. The release workflow then:

1. runs the full test and official MCP SDK gates;
2. assembles and verifies the Windows x64 SEA artifact;
3. writes `SHA256SUMS.txt`;
4. creates the GitHub Release and marks it Latest.

The workflow has no npm or Gitee credentials and publishes only verified GitHub
Release assets. See the
[release pipeline specification](docs/productization/real-release-pipeline-spec.md)
and [release gates](docs/productization/release-gates.md).

## Contributing

Real application edge cases are especially valuable: custom-drawn controls,
tray restoration, high-DPI scaling, multilingual input, focus transitions, and
post-action verification. Start with [CONTRIBUTING.md](CONTRIBUTING.md), or open
an [app smoke report](https://github.com/astraclawteam/agent-computer-use-mcp/issues/new?template=app_smoke.yml).

Security-sensitive findings should use
[GitHub private vulnerability reporting](https://github.com/astraclawteam/agent-computer-use-mcp/security/advisories/new).

## License

[MIT](LICENSE)
