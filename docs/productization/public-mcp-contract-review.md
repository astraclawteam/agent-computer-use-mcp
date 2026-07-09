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
| computer.repair | reviewed | compatible | overlay-free | reviewed | Approval-gated repair plan; no implicit download or desktop control. |
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
