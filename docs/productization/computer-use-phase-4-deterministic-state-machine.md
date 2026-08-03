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

## Guarded transition contract

| Step | Preconditions | Postconditions | Default timeout | Allowed next step |
| --- | --- | --- | ---: | --- |
| `restore-main-window` | One consistent `Window/main-window`; if not foreground it allows `activate_window`. | The same logical window is foreground in a newer Scene, or was already foreground. | 15 s | `resolve-target` |
| `resolve-target` | The main Window has one authoritative current Scene. | The Host chooses exactly one guarded route: an already-active exact title, one exact actionable visible candidate, or discovery through search. | 15 s | `verify-conversation-title`, `select-visible-target`, or `focus-search` |
| `select-visible-target` | One exact `ActionableItem/target-candidate` belongs to the `Container/target-list`. | The candidate identity becomes the active conversation title in a newer Scene. | 15 s | `verify-conversation-title` |
| `focus-search` | One clickable `Editable/search` belongs to the main window. | The search editable owns focus in a newer Scene. | 15 s | `enter-query` |
| `enter-query` | The focused search editable allows `type_text`. | Its value exactly equals the requested query in a newer Scene. An indeterminate write may be resolved only by this fresh postcondition and is never replayed. | 15 s | `wait-results-stable` |
| `wait-results-stable` | A `TransientSurface/search-results` belongs to the main window. | The same owned actionable candidate identities occur in two consecutive Scenes. | 15 s | `select-result` |
| `select-result` | Exactly one stable result has an exact normalized semantic label match. | The exact owned result surface is natively dismissed, or a conversation container is visible in a newer Scene; the next step still must verify the conversation title. | 15 s | `verify-conversation-title` |
| `verify-conversation-title` | One title belongs to that conversation container. | Its semantic identity, or label when no semantic identity exists, matches the selected result. | 15 s | `focus-message-editor` |
| `focus-message-editor` | One clickable message editor belongs to the conversation. | The editor owns focus in a newer Scene. | 15 s | `enter-message` |
| `enter-message` | The focused editor allows `type_text`. | Its value exactly equals the requested message in a newer Scene. An indeterminate write may be resolved only by this fresh postcondition and is never replayed. | 15 s | `send` |
| `send` | The editor still has the exact draft; one clickable send item belongs to the conversation. | The action is committed, or one fresh post-action Scene proves both a cleared editor and a new exact self-authored bubble. An indeterminate click is never replayed. | 15 s | `verify-new-bubble` |
| `verify-new-bubble` | One transcript belongs to the conversation, and the Host retains the pre-send exact self-bubble evidence. | A newer Scene contains either more exact self-authored bubbles or an exact self-authored latest bubble overlapping the post-send changed region; the bubble remains under that transcript. | 15 s | `release` |
| `release` | A lease is held, or terminal cleanup is required. | Host returns a committed release receipt. | 2 s | none |

The code exports this graph as `DETERMINISTIC_MESSAGING_STEPS`; tests verify
every allowed edge and each executed route. The Host never lets the model choose
between these transitions.

A successful `complete` receipt also exposes `toolErrorCount: 0` and
`wrongSendCount: 0`. The latter is a Host-owned conclusion available only after
the selected conversation title and the new self-authored bubble both pass the
state-machine postconditions; incomplete and failed workflows do not claim it.

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

Visible targets use the same generic Scene ownership rules. A
`Container/target-list` is composed from the current layout, and a child
`ActionableItem/target-candidate` is emitted only when an independently detected
row surface and owned OCR label agree. The action remains bound to the current
screenshot, Window, coordinate space, crop offset, scale, and observation
version. OCR-only rows, duplicate exact labels, and conflicting labels cannot
be clicked. These roles describe a selectable collection; they do not encode an
application name or messaging-product keyword.

Exact editable values remain Host-owned postconditions. A verified native
read-back is projected into the same returned Scene instead of creating a
parallel value store. When native read-back is unavailable, one delivered
`replace-all` mutation may be confirmed by a fresh exact OCR value inside the
same editable even if that value was already present before the idempotent
action. Insert mode still requires a newly observed occurrence.

The send role is also composed inside the Host. OCR supplies the exact semantic
label, pixels supply the control surface, and their evidence association must be
explicit before the Scene exposes `ActionableItem/send`. If a fresh Scene lacks
that role, the Host may refine the same unconsumed screenshot with a bounded
editor OCR pass; it does not recapture the desktop, change coordinate versions,
or let the model choose geometry. New-bubble verification compares against the
full pre-send transcript baseline so a partial crop cannot turn an older bubble
into a new one.

## Verification

Run:

```powershell
npm run verify:deterministic:messaging
```

The fixed Host driver proves all three target-resolution routes, strict step
metadata, precondition failure without skipping, title/body ownership isolation,
terminal `not-applied` and `indeterminate` receipts, action timeout, active Stop,
fresh self-authored bubble ownership, and release-on-all-terminal-paths.

Fuzzy semantic choice is intentionally not guessed here. Phase 5 now supplies a
bounded LLM decision port limited to selecting among Host-provided candidates;
see `computer-use-phase-5-llm-boundary.md`. Real application acceptance and the
staged foreground/tray/multi-window matrix remain Phase 6 work and must not be
inferred from these deterministic fixtures.
