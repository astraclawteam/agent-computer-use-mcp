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
| `computer.task` | Navigate native desktop or operating-system UI, or perform a non-submitting exact edit, through Host-owned observations and opaque semantic candidates; browser-native web pages and Host in-app previews use their dedicated capabilities when available. |
| `computer.message` | Send exact content to an explicit contact or conversation through the Host-owned deterministic messaging state machine. |

The lifecycle tools (`computer.acquire`, `computer.observe`, `computer.act`,
and `computer.release`) are workflow-internal. Health, doctor, installation,
and repair are also Host-only.

That boundary is carried by the advertised MCP contract, not by a vendor
convention. `tools/list` returns exactly `computer.task` and `computer.message`
unless the process was launched in host mode, and `tools/call` rejects every
name the surface did not advertise with the same error as a tool that does not
exist. A standard MCP Host therefore enforces the boundary without knowing
anything about this implementation:

```text
default launch          → computer.task, computer.message
--tool-surface=host     → the full ten-tool Host surface
```

The default surface is not a reduced desktop engine. `computer.task` and the
Host lifecycle tools consume the same versioned Scene, action implementation,
and receipts; the default surface only keeps targeting and controller lifecycle
inside the MCP server. A desktop control that is editable through Host mode must
therefore also be offered as an opaque `edit` candidate through `computer.task`.

Host mode is selected only from launch arguments or the
`AGENT_COMPUTER_USE_TOOL_SURFACE` environment variable, both owned by whoever
spawns the process. Nothing the Agent sends over the transport can widen its own
inventory. An unrecognized surface value fails at startup rather than quietly
falling back.

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
- **Editing never implies submission.** `computer.task` exposes a proven
  `Editable` as one atomic replace-all action, grounds it in the current
  screenshot, and commits only after exact-value read-back. It never exposes a
  send/submit control or presses a commit key. Contact selection, conversation
  verification, sending, and new-bubble proof remain exclusive to
  `computer.message`.
- **Navigation delivery is grounded before mutation.** For a Host-selected
  navigation control with current same-window semantic bounds, the Host chooses
  one foreground pointer delivery inside that owned rectangle. It does not
  invoke first and then retry by coordinate. The first post-action screenshot
  carries the control anchor; an in-window popup is merged into the Scene only
  when its OCR rows agree with an anchor-local changed region or an
  independently detected flat pixel surface. An already-open popup can
  therefore expose its owned navigation items without replaying its toggle.
- **Chinese input is a first-class path.** Coordinate-grounded Unicode entry
  uses verified native delivery, while semantic fields remain on the driver
  path.
- **Screenshots are assets, not file paths.** The Host receives controlled MCP
  image content; the Agent never needs access to a temporary local file.
- **Control has a lifecycle.** Leases are bound to the requesting Host session
  and are revoked on completion, cancellation, timeout, disconnect, or process
  shutdown.
- **Task routing cannot escape the Host.** A live generic task result carrying
  an opaque task token limits the next interaction step to `computer.task`;
  terminal results expose no continuation control. Shell, raw targeting, and lifecycle
  tools cannot replace an unresolved Host candidate. Same-package child
  processes inherit only their proven owning-window process identity. A
  navigation click whose Scene postcondition is not proven closes without
  replay, even if the provider reported delivery. Once issued, the opaque task
  token owns continuation scope; the model does not restate or paraphrase the
  application and goal on later steps. A mixed-layout application may contain
  a chat-like pane while the goal is ordinary navigation; `computer.task`
  may expose its proven editor only as a non-submitting `edit` candidate while
  hiding send controls, conversation targets, transcript, and descendants.
  Only an explicit recipient-plus-send request uses `computer.message`.
- **Browser-native work keeps its native path.** Chrome or Chromium web-page
  interaction belongs to a dedicated browser capability such as `agent-browser`
  when the Host provides one, and XiaozhiClaw's in-app preview belongs to
  `preview_browser`. Computer Use remains the visible native-desktop and
  operating-system UI path, plus the fallback when a browser-native path cannot
  complete the interaction.
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

That configuration gets the Agent surface: two task-level tools, no lifecycle or
management tools in the model's inventory. Only add
`"args": ["--tool-surface=host"]` if your Host itself owns user approval,
controller lifecycle, and tool projection — it hands the model eight more tools,
including direct desktop mutation and repair.

For the default Agent surface, start `computer.task` with `applicationName` and
`goal`. Choose a returned opaque `candidateId`; when that candidate declares
`inputRequired: true`, provide the exact text in the task-level `text` field.
`relevance: "route"` describes a reversible path toward a target that is not yet
visible; it is not an action name. Element ids, bounds, observations, and surface
receipts intentionally remain Host-owned.

For a Host integration, calling `computer.acquire` without a selector returns
fresh application and window candidates without starting control. The next call
accepts exactly one selector: `applicationToken` restores the primary window,
`windowId` selects that exact observed window, `applicationName` resolves one
exact current product name, and `target: "foreground"` selects the current OS
foreground window. Combining selectors returns `window.selector_conflict` with
the selector meanings; the retired partial-title selector is rejected.
`computer.act` accepts one canonical `action` object and uses `action.value` for
`set_value` and `type_text`; task-level `text` and nested `action.action`
envelopes are not aliases. A returned `surfaceReceipt.id` optionally binds an
action to that latest single-use surface and expires when a new observation
replaces it, the action consumes it, or the lease ends.

The release contains the exact Windows x64 driver, native overlay, ONNX runtime,
PP-OCRv6 model pack, inventory, checksums, licenses, and SBOM used by CI. It
requires no npm install and performs no network access at startup.

## Safety model

Computer Use is intentionally visible and bounded:

- the Host owns approval, process lifecycle, installation, and media assets;
- the tool surface is chosen at launch and defaults to the Agent surface, so an
  unconfigured Host cannot expose lifecycle or management tools by accident;
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
4. registers and signs the artifact through the pinned Hub publisher;
5. verifies the exact version repeatedly through the public Hub catalog;
6. creates the GitHub Release and marks it Latest.

The Hub registration job has only its dedicated release transport credentials;
the final isolated GitHub job receives `contents: write` only after the public
catalog gate passes. The workflow has no npm publishing credential and does not
mutate Gitee source. See the
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
