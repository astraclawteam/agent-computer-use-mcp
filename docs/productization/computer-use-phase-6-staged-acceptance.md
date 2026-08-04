# Computer Use Phase 6: staged real-application acceptance

Status: the three Host side-effect primitives and the deterministic messaging
workflow are implemented on `main`. Formal seven-level qualification is not
recorded as a manual score in this document. When maintainers choose to run it,
the result is determined exclusively by the sealed
`release-evidence/phase-6.json` manifest and
`npm run verify:phase-6:release-evidence`. Natural-prompt smoke observations do
not count toward that ladder. Preview version publication does not require a
live desktop campaign; the operator owns the release decision.

## Acceptance boundary

The Host owns three primitive classes:

- Navigation: click only a current Scene candidate and commit only after a
  page, menu, focus, selection, or equivalent observable state change.
- Editing: focus, replace-all, enter text, and read back the resulting value;
  do not submit by default.
- Messaging: resolve an explicit target, verify the conversation identity,
  enter the explicit content, send once, verify a new bubble, and release.

`computer.task` handles generic non-messaging goals. `computer.message` handles
messaging end to end. The Agent can interpret the goal, choose among opaque Host
candidates, resolve genuine visual ambiguity, and decide whether to reobserve
or report a failure. It cannot guess coordinates, assign OCR text to regions,
infer a title from body text, replay an indeterminate action, or manage the
controller lifecycle.

Every actionable Scene element has an identity and role, parent container,
observation version, coordinate provenance, evidence sources and consistency,
supported actions, and invalidation conditions. OCR-only or conflicting
evidence is non-actionable. Every action outcome is exactly `committed`,
`not-applied`, or `indeterminate`; an indeterminate mutation is never replayed
automatically.

## Deterministic messaging workflow

The Host-owned step order is fixed:

```text
restore-main-window
→ focus-search
→ enter-query
→ wait-results-stable
→ select-result
→ verify-conversation-title
→ focus-message-editor
→ enter-message
→ send
→ verify-new-bubble
→ release
```

The Host may select an exact, consistently evidenced visible target before
searching. Otherwise it follows the search route. This is role- and
postcondition-driven: no application name, contact name, message body, or
coordinate is encoded in transition selection. A failed step cannot skip
forward, and an uncertain side effect cannot be retried automatically.

## Fixed seven-level ladder

1. WeChat foreground, full contact identity.
2. WeChat foreground, fuzzy contact identity.
3. WeChat restored from the tray, fuzzy contact identity.
4. WeChat with auxiliary windows, fuzzy contact identity.
5. Consecutive sessions.
6. Operator Stop and fault injection.
7. Another Windows application using the same Host roles and postconditions.

Each level requires ten consecutive real Windows attempts before the next level
may start. A failure resets only the active level's streak. An attempt passes
only when all of the following are true:

- the workflow is driven through the Host Scene and the applicable primitive;
- elapsed time is at most 60 seconds;
- tool errors and wrong sends are both zero;
- required postconditions are verified;
- no indeterminate mutation is replayed;
- cancellation and fault paths produce no later click or input;
- the controller is released and idle at the terminal state.

Multi-window, consecutive-session, Stop, restart, and fault-injection levels
must also retain the corresponding lifecycle proof. Later levels cannot be
credited before all earlier levels qualify.

## Optional qualification evidence

Retained evidence is privacy-safe and rejects unknown fields. It cannot contain
contact names, message bodies, OCR text, screenshots, local paths, raw window
titles, or model transcripts. The qualification verifier accepts only a complete sealed
manifest whose seven ordered levels each contain a ten-attempt passing streak
and whose source identity matches the qualified source commit.

The tag release workflow does not invoke this verifier automatically. A
maintainer may require it for a named qualification or public-readiness claim;
contract-only and simulated tests still do not count as real attempts for such
a claim.

Verification commands:

```powershell
npm run verify:phase-6:contract
npm run verify:deterministic:messaging
npm run verify:bounded:llm
```
