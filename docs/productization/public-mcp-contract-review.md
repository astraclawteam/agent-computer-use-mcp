# Public MCP Contract Review

- Schema Version: 1
- Result Schema Version: 5.3
- Requires Human Review: true
- Compatibility Reviewed: true
- Overlay Exclusion Reviewed: true
- Desktop Control Reviewed: true

This review records the public `computer.*` MCP contract that requires human PR review before release. The executable Phase 5.7 gate checks that every public tool is represented here, that each result contract remains versioned, and that overlay/desktop-control risk has been reviewed without starting desktop control.

| Tool | Review Status | Compatibility | Overlay Exclusion | Desktop Control | Notes |
| --- | --- | --- | --- | --- | --- |
| computer.health | reviewed | compatible | overlay-free | reviewed | Read-only health report; must not start desktop control. |
| computer.doctor | reviewed | compatible | overlay-free | reviewed | Read-only diagnostics; repair actions remain plan-only. |
| computer.repair | reviewed | compatible | overlay-free | reviewed | Defaults to plan-only; optional start/status/cancel lifecycle is approval-bound. Agent input cannot replace host manifest, signature, keyring, offline root, program root, or data root. |
| computer.installation | reviewed | compatible | overlay-free | reviewed | Read-only install manifest and client config templates. |
| computer.request_access | reviewed | compatible | overlay-free | reviewed | May start desktop control only after policy and approval requirements. |
| computer.approve | reviewed | compatible | overlay-free | reviewed | Approval transition may start user-only overlay after explicit approval. |
| computer.capture | reviewed | compatible | overlay-free | reviewed | Captures must preserve includeUserOverlay=false. |
| computer.act | reviewed | compatible | overlay-free | reviewed | State-changing action remains allowlisted and policy-gated. |
| computer.cancel | reviewed | compatible | overlay-free | reviewed | Stops active control and leaves no observation overlay. |
| computer.revoke | reviewed | compatible | overlay-free | reviewed | Revokes active control and clears module state. |
| computer.list_state | reviewed | compatible | overlay-free | reviewed | Read-only state listing; no desktop control. |
| computer.capture_window | reviewed | compatible | overlay-free | reviewed | Window capture artifact path must exclude user overlay. |
| computer.ocr_region | reviewed | compatible | overlay-free | reviewed | Local OCR input must exclude user overlay. |
| computer.observe_diff | reviewed | compatible | overlay-free | reviewed | Dirty-region OCR diff path must exclude user overlay. |
## Browser Kernel Boundary

`agent-computer-use-mcp` is an OS Computer Use MCP package. `PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment. Gateway-managed components MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel. Built-in preview automation reaches that owner only through the host's high-level Preview semantic contract and never receives a raw CDP endpoint.

Third-party agent-native Computer Use remains agent-owned: agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement. This package exposes only the OS-oriented `computer.*` contract and does not wrap, intercept, or replace third-party agent-native capabilities.

End-to-end agent-native routing is a host-owned invariant and is not implemented by this MCP package. The XiaozhiClaw host runtime owns the executable routing test that proves agent-native calls bypass Gateway approval, target leases, policy enforcement, and Gateway-managed overlays.


