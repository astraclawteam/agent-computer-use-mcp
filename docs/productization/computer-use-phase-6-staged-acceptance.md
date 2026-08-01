# Computer Use Phase 6: staged real-application acceptance

Status: the Level 1 composition blocker is repaired on `main`; attempt 1 has
restarted and passed `restore-main-window` plus `focus-search`. It is paused
before `enter-query` because no explicit real test contact or message body was
provided. The attempt is not counted as passed or failed. No message was
entered or sent, no later level was started, and no candidate artifact was
generated.

## Gate contract

The acceptance order is fixed:

1. WeChat foreground, full contact identity.
2. WeChat foreground, fuzzy contact identity.
3. WeChat restored from the tray, fuzzy contact identity.
4. WeChat with auxiliary windows, fuzzy contact identity.
5. Consecutive sessions.
6. operator Stop and fault injection.
7. another Windows application using the same Host roles and postconditions.

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

## First real Level 1 attempt

The attempt used the official MCP SDK client, the current source server, and
the configured real Windows driver. It selected exactly one returned WeChat
window and acquired a full controller lease.

The initial and refreshed semantic Host Scenes contained only:

- one consistent `Window/main-window`;
- one consistent `Container/observation-viewport`;
- no `Editable/search`;
- no actionable search control.

A bounded visual observation then produced 81 window-local OCR text elements.
Every OCR element correctly remained non-actionable with
`evidenceConsistency=insufficient`. No structure or independent visual proposal
established a search-editable parent, so the deterministic
`focus-search` precondition failed closed. Using a guessed coordinate would
violate the Phase 3 and Phase 5 contracts and was not attempted.

The lease was cancelled and a fresh server session reported `status=idle` and
`activeController=null`. No click, text input, send action, or external message
occurred.

## Composition repair and Level 1 restart

The production observation path now composes one `Container/search-container`
and child `Editable/search` from the same-frame pixel surface plus OCR role
evidence. OCR text alone remains insufficient and non-actionable. Stable-frame
composition may use retained full-window OCR only as evidence input; it does
not expose retained OCR as a current action target. Filled and focused-outline
control surfaces are handled separately, and conflicting independent evidence
still removes actions.

The real WeChat restart proved that both elements retained the current
screenshot id, window id, window-local coordinate space, crop offset, scale,
bounds, evidence sources, consistency, actions, and parent relationship. The
foreground fact is refreshed from native window state before Scene projection.
The real `focus-search` action then returned `committed`, issued a verified
focus receipt, and produced a newer consistent Scene where the search editable
reported `focused=true` and still authorized `type_text`.

No contact or message content is retained in this evidence. Because the
operator has not supplied an explicit full-contact test goal and message body,
the workflow released the controller before `enter-query`; a fresh connector
reported `status=idle` with no active controller. Levels 2–7 remain closed.

Focused contract verification:

```powershell
npm run verify:phase-6:contract
```

This phase is local acceptance evidence only. It is not release evidence and
does not change the existing Agent E2E qualification contract.
