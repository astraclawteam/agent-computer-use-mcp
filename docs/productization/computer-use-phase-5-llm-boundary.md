# Computer Use Phase 5: bounded LLM interaction

Status: implemented in the real MCP composition root on `main`. The
Agent-facing `computer.task` tool advances generic non-messaging GUI goals
through opaque Host candidates, while `computer.message` accepts only the
semantic application, query, and message slots and runs the Phase 4 messaging
state machine inside the Host.
Exact application and conversation matches complete without another model
decision. A non-exact application inventory match or ambiguous conversation
is returned only as opaque IDs for a bounded follow-up selection. The Host
restores the selected running application's main window before the fixed
workflow continues. The module does not own model credentials, provider
routing, or Agent lifecycle.

The Host request timeout is intentionally longer than the 60-second acceptance
SLA. The SLA remains a measured qualification result; the transport window
exists so a cold or slow run can still return one canonical terminal receipt
and a confirmed release instead of being truncated into an unstructured MCP
timeout.

## Allowed model authority

The deterministic messaging boundary has exactly four decision kinds:

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

For `computer.task`, goal understanding and opaque candidate selection follow
the same authority limits. Between Host-released invocations the model may also
return only `complete`, `reobserve`, `report`, or `cancel`. These values choose
task continuation, not controller operations: the Host still acquires and
releases internally, `reobserve` is read-only, and neither `report` nor `cancel`
can request an action or replay.

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

`computer.task` is the generic Agent-facing desktop path. The model supplies an
application name and user goal, then selects only opaque application or Scene
candidates. The Host reacquires and observes a fresh Scene before every
selection, requires a unique match to the prior semantic candidate, performs at
most one action, and captures the post-action Scene. Navigation clicks are
committed only when that newer Scene proves an advanced target state, a
target-labelled destination, or a newly owned actionable transient surface.
The public action receipt retains the provider outcome separately from the
Host-decided outcome and lists the proof class and observation versions; an
unrelated changing fact is never a navigation postcondition. If the first Scene
is inconclusive, the Host performs at most one read-only related-surface capture
without replaying the click. The Host then returns only consistent parent-owned
facts and fresh opaque candidates and releases before the tool result. Candidate
output contains no coordinate, crop, provider token,
`elementId`, controller, or lifecycle field. `not-applied` and `indeterminate`
actions are never replayed. Stop cancels the in-flight invocation and release
still runs before the terminal result.

Every result installs an interaction-step execution control whose only allowed
next tool is `computer.task`. This prevents shell and low-level GUI bypass
without incorrectly marking the whole turn terminal; the next Host result
renews the same boundary. When an exact process has no window, the Host may
bind an owning window only from same-application-family process evidence or
consistent root-level `Window/Application/Document` Scene evidence. Failed
process candidates are invalidated for that task state.

`computer.message` is the only Agent-facing messaging mutation path. It owns
acquire, current Scene observation, element-targeted actions, guarded transition
selection, canonical receipts, Stop propagation, and release. Raw coordinate or
provider-token mutations are rejected once the Host Scene is recognized as a
messaging interface. The low-level lifecycle tools are Host-only and cannot be
selected by the Agent. Model-facing observations omit inconsistent evidence,
provider bindings, and chat-body bubbles.

`runLlmBoundedMessagingWorkflow` performs goal understanding before creating
the deterministic Phase 4 state machine. The Host first resolves an already
active exact target or one exact visible candidate and falls back to search only
when neither is proven. During `select-result`, the state
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
