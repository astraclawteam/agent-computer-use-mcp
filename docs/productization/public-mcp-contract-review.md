# Public MCP Contract Review

- Schema Version: 1
- Result Schema Version: 6.0
- Requires Human Review: true
- Compatibility Reviewed: true
- Overlay Exclusion Reviewed: true
- Desktop Control Reviewed: true

This review records the public `computer.*` MCP contract that requires human PR review before release. The executable Phase 5.7 gate checks that every public tool is represented here, that each result contract remains versioned, and that overlay/desktop-control risk has been reviewed without starting desktop control.

## Tool Surface

Host-only status is enforced by the advertised inventory, not by the private `xiaozhiclaw/visibility` `_meta` key. The server resolves one surface per process from launch arguments or environment before any transport exists:

| Surface | Selected by | `tools/list` |
| --- | --- | --- |
| `agent` (default) | any launch without an explicit signal | `computer.task`, `computer.message` |
| `host` | `--tool-surface=host`, `--host-control`, or `AGENT_COMPUTER_USE_TOOL_SURFACE=host` | all ten tools |

`tools/call` applies the same gate. A name the active surface did not advertise returns the `tool_not_found` error a genuinely unknown name returns, with no detail distinguishing the two, so the error cannot confirm which hidden tools exist. The `_meta` key remains advisory for Hosts that already read it, and `computer.installation` publishes the surface contract under `manifest.toolSurface`.

Rows marked Host-only below are therefore absent from a default-launch inventory rather than merely annotated.

## Error Envelope

Every tool can terminate with the shared envelope `{ resultSchemaVersion, includeUserOverlay, status: "error", error }`. Each `outputSchema` models this as a first-class branch: the top-level `required` list holds only `resultSchemaVersion` and `includeUserOverlay`, and an `allOf` requires the tool's success fields only when `error` is absent.

A tool that constrains `status` with an enum must therefore admit `"error"` as well. `computer.task`, `computer.message`, and `computer.act` are the tools that constrain it today; the shared schema builder adds `"error"` to any such enum so a new tool cannot reintroduce the gap. Omitting it makes a tool's own failure result fail the tool's own published schema, and an official MCP SDK client answers `-32602` instead of delivering the error.

`"error"` is never folded into a terminal outcome such as `not-applied`. Results that are genuinely not applied are converted earlier by the safe-rejection path with `applied: false` and `mayHaveSideEffects: false`; anything that reaches the shared envelope has already failed that check, so reusing a terminal outcome would report a possibly delivered mutation as replay-safe.

| Tool | Review Status | Compatibility | Overlay Exclusion | Desktop Control | Notes |
| --- | --- | --- | --- | --- | --- |
| computer.task | reviewed | compatible | overlay-free | reviewed | Additive Agent-facing generic non-messaging Host workflow; the initial call accepts application and goal while continuation is owned by the opaque Host token. Every invocation revalidates one opaque Scene candidate, excludes messaging-only controls and facts without rejecting a mixed-layout application shell, chooses one Host-grounded delivery route before mutation, applies at most one action, composes same-window transients only when OCR rows agree with anchor-local changed-region or stable flat-surface pixel structure, commits navigation only from a newer consistent Scene postcondition, returns a compact Host verification receipt and parent-owned facts, constrains the next interaction step to this tool, and releases before returning. |
| computer.message | reviewed | compatible | overlay-free | reviewed | Agent-facing deterministic messaging workflow; the Host owns Scene coordinates, fixed step ordering, mutation verification, no-replay policy, and controller release. |
| computer.acquire | reviewed | compatible | overlay-free | reviewed | Host workflow-internal; may start desktop control only after policy and approval requirements and an interactive input-desktop check. |
| computer.observe | reviewed | compatible | overlay-free | reviewed | Host workflow-internal; detailed observations expose one versioned Host Scene, and raw provider elements remain evidence rather than parallel action targets. |
| computer.act | reviewed | compatible | overlay-free | reviewed | Host workflow-internal; targets the current Scene by elementId and returns exactly committed, not-applied, or indeterminate. |
| computer.release | reviewed | compatible | overlay-free | reviewed | Host workflow-internal; stops active control and clears pending access without leaving an observation overlay. |
| computer.health | reviewed | compatible | overlay-free | reviewed | Host-only health report includes the versioned capability handshake; never projected to the Agent. |
| computer.doctor | reviewed | compatible | overlay-free | reviewed | Host-only diagnostics; repair actions remain plan-only. |
| computer.installation | reviewed | compatible | overlay-free | reviewed | Host-only install manifest and client config templates. |
| computer.repair | reviewed | compatible | overlay-free | reviewed | Host-only and approval-bound; settings request a plan without immediate execution. |
## Browser Kernel Boundary

`agent-computer-use-mcp` is an OS Computer Use MCP package. `PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment. Gateway-managed components MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel. Built-in preview automation reaches that owner only through the host's high-level Preview semantic contract and never receives a raw CDP endpoint.

Third-party agent-native Computer Use remains agent-owned: agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement. This package exposes only the OS-oriented `computer.*` contract and does not wrap, intercept, or replace third-party agent-native capabilities.

End-to-end agent-native routing is a host-owned invariant and is not implemented by this MCP package. The XiaozhiClaw host runtime owns the executable routing test that proves agent-native calls bypass Gateway approval, target leases, policy enforcement, and Gateway-managed overlays.


