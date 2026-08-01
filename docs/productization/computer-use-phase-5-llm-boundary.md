# Computer Use Phase 5: bounded LLM interaction

Status: implemented and verified with an injected Host completion port on
`main`. The Computer Use module does not own model credentials, provider
routing, or Agent lifecycle. Runtime/Agent supplies the structured completion
function; this module owns the admissible decision contract and validates every
model result before it can affect the deterministic workflow.

## Allowed model authority

The LLM has exactly four decision kinds:

| Kind | Model input | Only valid output | Host validation after output |
| --- | --- | --- | --- |
| `understand-goal` | Original user goal text. | `{query, message}` | Both are non-empty strings; no other field is accepted. |
| `select-candidate` | Intent plus current Host-owned candidate IDs, labels, roles, parent roles, and evidence-source names. | `{candidateId}` | ID must belong to the current stable candidate set. Host maps it to the current Scene element. |
| `resolve-visual-ambiguity` | Host-declared visual evidence ID, one layout question, and bounded Host-owned options. | `{optionId}` | Host must first mark the issue as a genuine unresolved layout ambiguity; returned ID must be an offered option. |
| `decide-failure` | Failure code, deterministic step, canonical outcome, and whether a fresh observation is available. | `{decision: reobserve\|report}` | No action, replay, retry, or lifecycle operation is representable. |

Every request has a strict output schema with `additionalProperties: false` and
a bounded timeout. An already-cancelled Host signal prevents the model call.
Unknown IDs, additional fields, unsupported decisions, malformed structures,
and late results fail closed.

## Information the model does not receive

Candidate selection does not expose:

- pixel positions, bounds, crop offsets, scale, or coordinate spaces;
- provider element tokens or actionable Scene `elementId` values;
- raw OCR collections or text from unrelated regions;
- chat-body text for conversation-title verification;
- controller, acquire, release, cancellation, or replay controls.

The Host creates opaque `candidate:N` identities for the current observation
and retains the mapping to Scene elements. Only structurally owned,
evidence-consistent, actionable results reach this list. A model-selected ID is
therefore a semantic choice, not an action target supplied by the model.

## Workflow composition

`runLlmBoundedMessagingWorkflow` performs goal understanding before creating
the deterministic Phase 4 state machine. During `select-result`, the state
machine supplies current stable candidates to the bounded decision port, maps
the selected opaque ID back to the current `elementId`, and performs the click
itself. Conversation title, focus, input value, send result, new-bubble
ownership, timeouts, allowed transitions, and release remain deterministic Host
postconditions.

If a workflow failure is eligible for another observation, the LLM may choose
one fresh Host observation or immediate reporting. The Host performs at most one
read-only failure observation, records `actionReplayed: false`, and then
releases. An `indeterminate` action is never submitted again. Stop bypasses the
model failure decision so cancellation and release are not delayed by the LLM.

Visual ambiguity resolution is exposed as a separate bounded decision. It does
not turn conflicting evidence into an actionable element and cannot call an
action. The Host must incorporate the selected interpretation into a new Scene
and re-run normal evidence/admission checks.

## Verification

Run:

```powershell
npm run verify:bounded:llm
```

The gate proves goal-slot extraction, fuzzy candidate choice, request
minimization, unknown-ID rejection, additional-field rejection, explicit visual
ambiguity admission, cancellation before model invocation, `reobserve/report`
restriction, no replay after an indeterminate action, no action after a model
contract violation, and release on every terminal path.

This phase does not run the Phase 6 real-application acceptance matrix, publish
a version, or generate a candidate artifact.
