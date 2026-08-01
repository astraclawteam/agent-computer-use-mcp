# Computer Use Phase 4: deterministic messaging state machine

Status: implemented and verified with a fixed Host Scene driver on `main`.
This phase does not run an Agent, an LLM-planned task, or a complete real
application task. It does not publish or assemble a release candidate.

## Authority and inputs

`DeterministicMessagingStateMachine` consumes only:

- a versioned Host `Scene`;
- the requested query and message strings;
- Host `act` receipts with exactly `committed`, `not-applied`, or
  `indeterminate` outcomes;
- Host `release`.

The state machine never consumes raw OCR ownership guesses, provider tokens,
chat-body text as a title, or pixel coordinates. It targets current Scene
`elementId` values selected by element type, semantic role, parent-container
relationship, evidence consistency, action availability, and observed state.

## Fixed transition contract

| Step | Preconditions | Postconditions | Default timeout | Only allowed next step |
| --- | --- | --- | ---: | --- |
| `restore-main-window` | One consistent `Window/main-window`; if not foreground it allows `activate_window`. | The same logical window is foreground in a newer Scene, or was already foreground. | 5 s | `focus-search` |
| `focus-search` | One clickable `Editable/search` belongs to the main window. | The search editable owns focus in a newer Scene. | 5 s | `enter-query` |
| `enter-query` | The focused search editable allows `type_text`. | Its value exactly equals the requested query in a newer Scene. | 5 s | `wait-results-stable` |
| `wait-results-stable` | A `TransientSurface/search-results` belongs to the main window. | The same owned actionable candidate identities occur in two consecutive Scenes. | 5 s | `select-result` |
| `select-result` | Exactly one stable result has an exact normalized semantic label match. | A conversation container is visible in a newer Scene. | 5 s | `verify-conversation-title` |
| `verify-conversation-title` | One title belongs to that conversation container. | Its semantic identity, or label when no semantic identity exists, matches the selected result. | 5 s | `focus-message-editor` |
| `focus-message-editor` | One clickable message editor belongs to the conversation. | The editor owns focus in a newer Scene. | 5 s | `enter-message` |
| `enter-message` | The focused editor allows `type_text`. | Its value exactly equals the requested message in a newer Scene. | 5 s | `send` |
| `send` | The editor still has the exact draft; one clickable send item belongs to the conversation. | The action is committed and the editor is cleared in a newer Scene. | 5 s | `verify-new-bubble` |
| `verify-new-bubble` | One transcript belongs to the conversation. | A fresh self-authored exact-value bubble exists under that transcript. | 5 s | `release` |
| `release` | A lease is held, or terminal cleanup is required. | Host returns a committed release receipt. | 2 s | none |

The code exports this table as `DETERMINISTIC_MESSAGING_STEPS`; tests compare
the executable order with the contract rather than maintaining a second test
sequence.

## Failure and cancellation rules

- A missing or ambiguous precondition returns `workflow.precondition_failed`
  at the owning step. No later step runs.
- A `not-applied` action ends the workflow at that step. It is not retried.
- An `indeterminate` action ends the workflow at that step with
  `replayAllowed: false`. It is never replayed.
- A timeout aborts the in-flight Host call. If a mutation was in flight, the
  workflow result is `indeterminate`; otherwise it is `not-applied`.
- `stop()` aborts the current call, prevents every later click or input, and
  enters release cleanup.
- Release runs once on success, failure, timeout, or cancellation. Cleanup uses
  its own bounded timeout so an already-aborted workflow signal cannot suppress
  release.

## Scene additions required by deterministic postconditions

The Host Scene now preserves provider-declared structural parent relationships,
observable element `state`, and an optional `semanticKey`. The main `Window`
declares foreground state and `activate_window`. These are evidence fields,
not a second state store: each value belongs to exactly one observation version
and is invalidated by the next observation.

`semanticKey` is optional and must be declared by the Host/provider. Provider
element tokens remain internal bindings and are not promoted into semantic
identity. If no semantic key exists, the exact normalized visible label is used
only for this deterministic exact-result phase.

## Verification

Run:

```powershell
npm run verify:deterministic:messaging
```

The fixed Host driver proves the complete successful sequence, strict step
metadata, precondition failure without skipping, title/body ownership isolation,
terminal `not-applied` and `indeterminate` receipts, action timeout, active Stop,
fresh self-authored bubble ownership, and release-on-all-terminal-paths.

Fuzzy semantic choice is intentionally not guessed here. It remains a Phase 5
LLM responsibility limited to selecting among Host-provided candidates. Real
application acceptance and the staged foreground/tray/multi-window matrix remain
Phase 6 work and must not be inferred from these deterministic fixtures.
