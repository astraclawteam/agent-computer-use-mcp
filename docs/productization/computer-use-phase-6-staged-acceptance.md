# Computer Use Phase 6: staged real-application acceptance

Status: the known Level 1 Scene and composition-root blockers are repaired on
`main`, and Level 1 remains at 0/10 until a new real XiaozhiClaw attempt verifies
the sent result and final idle state. The Host can compose the
search editable from consistent evidence, import relationship-proven owned or
same-process auxiliary screenshots, and merge their windows, transient
surfaces, and independently grounded result rows into one versioned Scene. No
preflight is counted as passed or failed, no later level was started, and no
candidate artifact was generated.

The most recent failed real attempt used the former raw-tool composition: the
Agent inspected OCR/chat-body evidence, chose a visual coordinate, and exceeded
the 60-second limit. It was stopped before send and does not count. The current
composition exposes `computer.message`, keeps action targets and controller
lifecycle inside the Host, rejects raw messaging coordinates, and propagates
MCP cancellation into the in-flight deterministic workflow. Acceptance must
restart from Level 1 attempt 1 with this composition.

## Gate contract

The acceptance order is fixed:

1. WeChat foreground, full contact identity.
2. WeChat foreground, fuzzy contact identity.
3. WeChat restored from the tray, fuzzy contact identity.
4. WeChat with auxiliary windows, fuzzy contact identity.
5. Consecutive sessions.
6. Operator Stop and fault injection.
7. Another Windows application using the same Host roles and postconditions.

Every level requires ten consecutive real Windows attempts. A failed attempt
resets only the active level's streak. An attempt passes only when it is
Host-Scene-driven, completes within 60 seconds, reports zero tool errors and
zero mis-sends, preserves the deterministic step order, never replays an
uncertain action, verifies the expected outcome, and ends with the controller
released and idle. Level-specific lifecycle evidence is additionally required
for multi-window, consecutive-session, Stop, restart, and fault-injection
cases.

The recorder rejects unknown fields so contact names, message bodies, OCR text,
screenshots, and local paths cannot enter retained Phase 6 evidence. Local
candidate generation remains locked until all seven levels are 10/10.

## Historical Level 1 blockers

The first real attempt used the official MCP SDK client, current source server,
and configured Windows driver. Its Host Scene contained a consistent main
Window and observation viewport but no independently grounded search Editable.
OCR remained non-actionable, so `focus-search` failed closed without a guessed
coordinate. The controller was released and no external message occurred.

The first repair composed `Container/search-container` and child
`Editable/search` only from a same-frame pixel surface plus OCR role evidence.
It preserved the screenshot id, window id, coordinate space, crop offset,
scale, bounds, evidence sources, consistency, actions, and parent relationship.
A real focus action committed, produced a verified focus receipt, and a later
real replace-all query reached its exact postcondition. The result list still
could not be selected because the driver exposed it as a separate composited
screenshot without importing its native window ownership into Scene.

## Owned transient capture and Scene merge

The capture layer now consumes all screenshot images from one bounded driver
window-state response. It imports a non-primary image only after a native probe
proves that the corresponding visible HWND is owned by the controller window or
belongs to the same application process. Each imported surface carries its own
screenshot id, window id, screen origin, visible screenshot dimensions, native
window bounds, relationship provenance, and an explicit transform back to the
controller window's action coordinates.

Scene composition attaches the imported Window to the main Window and the
`TransientSurface/search-results` beneath that exact auxiliary Window. Its
search ownership is proven separately by the surface relationship and its
position relative to the search editable. OCR supplies text only within that
surface; a result becomes an
`ActionableItem/search-result` only when independent visual evidence agrees on
the same row. Detached, unproven, OCR-only, or conflicting surfaces remain
non-actionable. The native regression covers a composited screenshot whose
visible height is smaller than its underlying HWND so transparent or clipped
window regions cannot distort action coordinates.

The full source suite, deterministic workflow gate, bounded-LLM gate, Phase 6
contract gate, standard MCP client/server gates, and real MCP action lifecycle
pass with this repair. No private query or message body is retained here.

Focused contract verification:

```powershell
npm run verify:phase-6:contract
```

This phase is local acceptance evidence only. It is not release evidence and
does not change the existing Agent E2E qualification contract.
