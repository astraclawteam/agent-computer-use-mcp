# Public MCP Contract Review

- Schema Version: 1
- Result Schema Version: 6.0
- Requires Human Review: true
- Compatibility Reviewed: true
- Overlay Exclusion Reviewed: true
- Desktop Control Reviewed: true

This review records the public `computer.*` MCP contract that requires human PR review before release. The executable Phase 5.7 gate checks that every public tool is represented here, that each result contract remains versioned, and that overlay/desktop-control risk has been reviewed without starting desktop control.

| Tool | Review Status | Compatibility | Overlay Exclusion | Desktop Control | Notes |
| --- | --- | --- | --- | --- | --- |
| computer.task | reviewed | compatible | overlay-free | reviewed | Additive Agent-facing generic non-messaging Host workflow; every invocation revalidates one opaque Scene candidate, applies at most one action, commits navigation only from a newer consistent Scene postcondition, returns a compact Host verification receipt and parent-owned facts, constrains the next interaction step to this tool, and releases before returning. |
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


