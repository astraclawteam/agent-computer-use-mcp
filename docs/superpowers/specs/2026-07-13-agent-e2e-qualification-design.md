# Agent E2E Qualification Design

**Status:** Qualification infrastructure implemented; real host session bridges and sealed campaigns pending
**Date:** 2026-07-13
**Repository:** `agent-computer-use-mcp`

## 1. Context

The repository has deterministic MCP protocol, runtime, perception, policy,
application harness, and evidence tests. Those tests do not prove that a real
AI agent can inspect an unexpected application state, choose the public MCP
tools, recover safely, and complete a natural-language task.

Existing application adapter tests use scripted or mocked MCP responses. They
prove adapter contracts only. They MUST NOT be described as a real application
or real agent pass. In particular, an installed application such as
LibreOffice 26.2.4.2 remains `unqualified` until sealed Agent E2E evidence
exists. A welcome page, recovery dialog, or other intermediate state is an
example of an unexpected state, not an application-specific pass condition.

This design adds a separate Agent E2E Qualification stage. It does not weaken
or replace PR6 runtime soak, PR7 application harness, or perception evidence.

## 2. Goals

- Qualify the released standard MCP package through real AI agent hosts.
- Run byte-identical natural-language tasks across every required host lane.
- Require the agent, rather than a test adapter, to make every application UI
  decision and invoke every public Computer Use action.
- Exercise real installed applications from their actual launch state,
  including controlled but non-scripted intermediate states.
- Produce immutable, privacy-safe evidence that binds host, model, package,
  driver, overlay, OCR runtime, and model pack identities.
- Make Agent E2E evidence a mandatory and independent Commercial 1.0 gate.

## 3. Non-goals

- No application-specific click paths, element labels, coordinates, or dialog
  handlers in qualification adapters.
- No test-side calls to `click`, `type`, `set_value`, `navigate`, or equivalent
  target-application actions.
- No direct file writes that simulate an agent save operation.
- No model fallback, prompt rewriting, or hidden per-host hints.
- No claim that fixture, unit, adapter, protocol, or soak tests are Agent E2E.
- No qualification of macOS or Linux before their platform packages and real
  host lanes are separately validated.

## 4. Required Qualification Lanes

The initial Windows x64 qualification matrix has four required lanes:

1. Codex.
2. Claude Desktop.
3. Xiaozhi Claw Web with DeepSeek V4 Flash.
4. Xiaozhi Claw Web with Claude Sonnet 5.

The Xiaozhi Claw development entry point is configurable and initially uses
`http://127.0.0.1:5174/`. The URL is not a product identity. Evidence records
the host build, backend session identity, provider, and actual model ID used by
the completed turn. Display names alone are insufficient.

Codex and Claude Desktop evidence likewise records the observable host version
and model identity. If a host does not disclose an exact model build, evidence
records the strongest stable identity it exposes and marks the unavailable
field explicitly; it never invents a value.

## 5. Architecture

```text
Qualification Task Pack
          |
Qualification Orchestrator
          |
   +------+------+--------------------------+
   |             |                          |
 Codex      Claude Desktop          Xiaozhi Web Driver
                                      |           |
                               DeepSeek V4   Claude Sonnet 5
   |             |                          |
   +-------------+--------------------------+
                 |
       released agent-computer-use-mcp
                 |
            target application
                 |
 Environment Adapter: prepare / launch / verify / cleanup only
```

The orchestrator owns scheduling, attempt accounting, timeout enforcement,
evidence sealing, and aggregation. It does not plan application operations.

### 5.1 Qualification Task Pack

A task contains only:

- stable task ID and schema version;
- natural-language goal;
- environment adapter ID;
- allowed application, window, and temporary workspace scope;
- final-state verifier ID and expected invariant;
- timeout, privacy, and approval policy;
- controlled initial-state seed.

A task MUST NOT contain target element names, coordinates, menu paths, dialog
instructions, host-specific prompt suffixes, or a correct action sequence. The
exact prompt bytes and SHA-256 are shared by all four lanes.

### 5.2 Environment Adapter

An environment adapter may only:

1. create an isolated profile and temporary workspace;
2. create synthetic input files that contain no user data;
3. select a controlled initial-state seed;
4. launch the target application;
5. report the target process/window scope to the host policy layer;
6. verify final files or structured application state;
7. terminate owned processes and remove temporary state.

It MUST NOT expose `observe` or `act` application workflows. It MUST NOT select
elements, close dialogs, open menus, enter values, save files, or call target
application action tools. App-specific logic is limited to safe setup, an
outcome verifier, and cleanup.

### 5.3 Host Driver

A host driver may only:

- create an isolated agent conversation;
- configure the released MCP package and required model lane;
- submit the canonical natural-language task;
- handle host-level approval UI according to the task policy;
- wait for terminal agent state or timeout;
- collect host transcript and MCP event references;
- cancel a runaway agent turn.

Host-level UI automation is allowed only for the agent host itself. The driver
MUST NOT control the target application, invoke Computer Use tools on behalf of
the agent, inject tool results, or alter observations.

### 5.4 Standard MCP Boundary

Every lane installs and invokes the same released public npm package through
the official MCP protocol. Qualification cannot import repository-private
router modules or call `cua-driver` directly. Tool schemas and approval
behavior must match the public package.

## 6. Execution Semantics

Each required task runs three successful qualification attempts in every lane.
One task therefore requires twelve successful runs across the four lanes.

- Pass requires `3/3` successful attempts in every lane.
- Each attempt uses a new agent conversation, MCP session, application profile,
  temporary workspace, and controlled initial-state seed.
- Only an `infrastructure-failure` may be retried once.
- The original infrastructure failure remains in evidence. Its retry does not
  erase or replace the failed attempt.
- Agent decision, perception, action, verification, policy, and cleanup
  failures are qualification failures and cannot be retried automatically.
- A newer passing run never hides an earlier qualifying failure for the same
  candidate identity and campaign.
- Model fallback or host switching invalidates the attempt.

## 7. Unexpected State Handling

Qualification is outcome-based. The task begins from the application state
that actually appears after the controlled launch. The agent must observe and
decide how to proceed.

Controlled seeds may produce an existing window, welcome surface, recovery
prompt, update prompt, empty document, file chooser, modal dialog, or multiple
eligible windows. These states exercise generic observation and replanning.
They are not named in the natural-language task and do not create
application-specific adapter handlers.

When the agent cannot establish a safe action, it must re-observe, choose a
different semantic strategy, ask for approval when policy requires it, or fail
explicitly. Guessed coordinates and unverified actions remain forbidden.

## 8. Initial Task Families

The first qualification pack covers:

- text editing and exact save verification;
- spreadsheet values and formula verification;
- presentation content and structure verification;
- browser form completion and generated-file download;
- Electron editor operation;
- system dialog and file chooser interaction;
- self-drawn or Canvas controls;
- multi-window selection and switching;
- generic intermediate-state recovery;
- cancel, revoke, timeout, approval, and policy denial.

Task inventory is versioned. Adding an easier duplicate never compensates for
a failed required task.

## 9. Failure Taxonomy

Every terminal failure has exactly one primary class:

- `infrastructure-failure`: host launch, model transport, or MCP connection
  failed before a valid agent decision could run; one retry is permitted.
- `agent-decision-failure`: the agent chose an invalid plan or terminated
  without completing the goal.
- `perception-failure`: observations were insufficient, incorrect, stale, or
  not used safely.
- `action-failure`: a selected public MCP action failed or affected the wrong
  allowed target.
- `verification-failure`: the claimed completion did not satisfy the external
  final-state verifier.
- `policy-blocked`: required action was correctly denied or approval was not
  granted; expected-denial tasks may treat this as their target outcome.
- `cleanup-failure`: owned processes, sessions, overlay/cursor state, ports, or
  temporary data remained after the attempt.

Only `infrastructure-failure` is retryable. Classification is performed from
host, MCP, verifier, and cleanup evidence, not from the agent's prose claim.

## 10. Evidence Contract

Each attempt seals an immutable directory:

```text
run-manifest.json
agent-transcript.jsonl
mcp-tool-events.jsonl
observation-summary.jsonl
verification.json
cleanup.json
checksums.txt
```

The manifest binds:

- campaign, task, lane, repetition, and initial-state seed;
- canonical prompt SHA-256;
- Git commit and released core/platform package identities;
- host build and actual provider/model identity;
- driver, overlay, OCR runtime, and OCR model pack identities;
- start/end timestamps and failure classification.

MCP events preserve ordered tool names, argument classifications, result
status, observation identity, lease identity, and timing. They do not preserve
secrets or unrestricted payloads.

### 10.1 Privacy

- No complete desktop screenshot, user document, raw OCR string, credential,
  username, or local user path is sealed or uploaded.
- Window pixels may exist ephemerally on the qualification machine for
  perception and local failure review, then are destroyed before sealing.
- Transcript and tool payloads are redacted before writing evidence.
- Fixtures use generated content and isolated profiles only.
- Evidence verification fails closed on forbidden fields, extra files,
  checksum mismatch, symlinks, or identity mismatch.

## 11. Qualification Aggregation

The aggregator is read-only. It verifies every evidence directory, groups by
exact candidate identity and campaign, and outputs:

- per-task and per-lane attempt status;
- failure distribution and latency summaries;
- prompt and task-pack identity;
- cleanup and privacy status;
- `agentE2eEligible`.

`agentE2eEligible` is true only when every required task has three successful
attempts in all four required lanes, no disqualifying run exists, and every
privacy, policy, identity, verification, and cleanup check passes.

## 12. Product Phases

### Phase 10.0: Qualification Contract

Freeze task, lane, attempt, failure, privacy, and evidence schemas.

### Phase 10.1: Environment Adapter Boundary

Remove application operation workflows from existing adapters. Preserve only
prepare, launch, verify, and cleanup responsibilities, with tests that reject
action-capable adapters.

### Phase 10.2: Real Host Drivers

Implement Codex, Claude Desktop, and Xiaozhi Web drivers. The Xiaozhi driver
supports two separately pinned lanes: DeepSeek V4 Flash and Claude Sonnet 5.

### Phase 10.3: Agent E2E Runner

Execute the canonical task pack through real hosts and the released public MCP
package with isolated attempts, timeouts, and retry classification.

### Phase 10.4: Sealed Evidence And Local Replay

Seal privacy-safe evidence and provide a local summary replay that cannot alter
or promote evidence.

### Phase 10.5: Commercial Promotion Gate

Require a verified Agent E2E aggregation report for stable `1.x` release
metadata. Preview releases report `agentE2eEligible: false` without claiming
commercial qualification.

## 13. Existing Claim Migration

- Phase 6.2 is renamed in product documentation as real-application harness
  and evidence infrastructure, not Agent E2E qualification.
- Mock adapter tests are contract tests only.
- The generated real-app matrix cannot mark an application qualified without
  sealed Phase 10 evidence.
- Existing Notepad, Native Lab, VS Code, LibreOffice, browser, WPS, and fixture
  observations remain development evidence gaps unless re-run through Phase
  10.
- Current historical evidence remains immutable and ineligible for the new
  gate; it is not edited or relabeled.

## 14. Release Integration

Commercial promotion requires all existing PR6/PR7 gates plus Phase 10.5. The
candidate identity must match across runtime soak, perception, real-app harness,
Agent E2E, package, and release metadata evidence.

The release gate fails closed for:

- a missing lane, task, or repetition;
- a prompt or task-pack mismatch;
- host or model fallback;
- an action-capable environment adapter;
- any disqualifying attempt;
- missing or invalid verification, privacy, or cleanup evidence;
- candidate identity mismatch.

## 15. Acceptance Criteria

Implementation is complete only when:

1. all four real host lanes use the same released MCP package and prompt bytes;
2. environment adapters cannot perform target-application actions;
3. every required task produces three successful attempts per lane;
4. infrastructure retry rules and non-retryable failures are enforced;
5. evidence is immutable, privacy-scanned, checksum-verified, and bound to one
   candidate identity;
6. the aggregator cannot infer, synthesize, or overwrite missing evidence;
7. stable `1.x` release readiness requires `agentE2eEligible: true`;
8. product documentation no longer equates mock, harness, or protocol tests
   with real Agent E2E qualification.
