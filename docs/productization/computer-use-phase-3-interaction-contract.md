# Computer Use Phase 3: Host interaction contract

Status: implemented on `main`; MCP result schema `6.0`.

This contract replaces provider-shaped observations and heterogeneous action
receipts at the Host boundary. Provider output remains internal evidence. The
Host Scene and the three-state action outcome are the only authorities exposed
by the Host interaction surface.

## Scene ownership

```text
Scene (observationId + observationVersion)
 └─ Window
     └─ Container
         ├─ Editable
         ├─ TransientSurface
         └─ ActionableItem
```

Every Scene element contains:

- `id`, `type`, provider-independent `role`, optional cross-observation
  `semanticKey`, and observable `state`;
- `parentId`;
- `observationVersion`;
- `coordinate.screenshotId`, `windowId`, `space`, `cropOffset`, `scale`, and
  `bounds`;
- evidence sources and `evidenceConsistency`;
- executable `actions` and `actionable`;
- explicit `invalidatesOn` conditions.

`elementId` is Host-internal and is accepted only by the Host workflow-internal
`computer.act` surface. The Agent-facing `computer.task` contract exposes an
opaque `candidateId`; the Host resolves it against the current Scene before
acting. Provider tokens remain private to the Host driver binding. A new
observation invalidates old Scene ids and candidate ids. The Router no longer
resolves stale semantic aliases.

OCR-only evidence has `evidenceConsistency: "insufficient"` and no actions.
Any provider-declared structure/OCR/visual conflict has
`evidenceConsistency: "conflict"` and no actions. Exact OCR text is no longer
an exception that can authorize a click.

## Action outcome

Every `computer.act` response has exactly one outcome:

| Outcome | Meaning | Replay rule |
|---|---|---|
| `committed` | The Host has sufficient evidence that the mutation committed. | Continue from a new observation. |
| `not-applied` | A precondition rejected the action before application. | Correct the precondition; do not treat it as a mutation. |
| `indeterminate` | The action may have produced side effects, but commitment is not proven. | Never replay automatically; observe or report. |

Legacy public outcomes (`applied`, `completed`, `delivered`, `unverified`, and
`blocked` for actions) are mapped at the MCP boundary and are not exposed.
Legacy driver fields such as `effect`, `replaySafe`, `delivered`, and
`completionEligible` are removed from the public receipt so they cannot become
a second outcome authority.

## Removed compensation paths

- OCR-only click admission, including the exact/high-confidence exception.
- Cross-observation semantic token aliases.
- Rewriting a click on the leading transient result to `press_key Enter`.
- Model-facing raw `elements`, `localObservation`, and `semanticProbe` as
  parallel action target collections.

The deterministic application state machine belongs to Phase 4. Phase 3 does
not run an Agent task or infer application-specific workflow transitions.
