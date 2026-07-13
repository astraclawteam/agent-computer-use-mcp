# Commercial Computer Use 1.0 Evidence Design

**Status:** Approved design

**Date:** 2026-07-13

## 1. Goal

Turn the existing Windows x64 preview into an evidence-backed commercial
Computer Use 1.0 candidate by closing four gaps:

1. real long-running runtime stability evidence;
2. repeatable automation evidence across real installed applications;
3. measurable OCR and complex-visual perception quality;
4. fail-closed promotion gates that cannot convert missing coverage into a
   passing result.

This design applies only to `agent-computer-use-mcp`. XiaozhiClaw host,
Preview Browser, CDP ownership, and shared target-lease integration are out of
scope for this implementation cycle.

## 2. Non-Goals

- Installing CAD, video editing, or other large commercial software solely for
  this validation cycle.
- Claiming support for software that is not installed and has no real evidence.
- Shipping benchmark corpora or test fixtures in the public npm packages.
- Introducing a large local vision model before a measured corpus failure
  demonstrates that the existing providers cannot meet the approved targets.
- Capturing or retaining private user documents, conversations, contacts,
  credentials, or complete desktop screenshots.
- Adding macOS or Linux support.

## 3. Delivery Strategy

Implementation is evidence-first and split into independently reviewable
changes:

1. **PR6A:** evidence core and a real 15-minute MCP daemon soak.
2. **PR6B:** two-hour nightly and eight-hour release-candidate soak evidence.
3. **PR7A:** real installed-application harness and adapters.
4. **PR7B:** versioned OCR and complex-visual benchmark corpora.
5. **PR7C:** failure-driven perception fixes and the Commercial 1.0 evidence
   aggregator.

No runtime perception change is accepted without a corpus sample that fails
before the change and passes after it.

## 4. Architecture

### 4.1 Evidence Core

Every environment validation writes one evidence directory containing:

```text
evidence/<run-id>/
  run-manifest.json
  events.jsonl
  report.json
  checksums.txt
  samples/
```

`run-manifest.json` binds the run to:

- schema version;
- run ID and deterministic scenario seed;
- Git commit and dirty-worktree state;
- core and platform package versions;
- complete platform and model-pack identities;
- operating system, architecture, CPU class, memory class, available execution
  providers, DPI, and monitor count;
- UTC start time, requested duration, and gate kind;
- corpus or application-catalog identities;
- privacy policy version.

Machine information is capability-oriented and redacted. User names, absolute
home paths, host names, serial numbers, IP addresses, environment variables,
and tokens are forbidden.

`events.jsonl` is append-only and records lifecycle, sampling, action,
observation, policy, fault, cleanup, and checkpoint events. A process crash
must leave enough events to diagnose the last successful checkpoint.

`report.json` is generated from events and referenced sample results. It cannot
accept caller-supplied summary numbers. `checksums.txt` covers every retained
file. The evidence verifier recomputes all hashes and rejects missing,
duplicate, unreferenced, or path-traversing entries.

### 4.2 Runtime Soak Executor

The soak executor launches the released MCP server through the official MCP
SDK stdio client. It must not use a virtual clock in environment evidence runs.
It performs seeded scenarios across multiple clients:

- health, doctor, observe, request-control, action, cancel, revoke, and close;
- concurrent tool calls within the supported controller policy;
- client disconnect during observation and action preparation;
- MCP child termination and supervised restart;
- duplicate daemon startup;
- transport interruption and reconnect;
- cancel, revoke, timeout, and shutdown while the overlay is starting;
- cleanup after failed OCR or driver sessions.

Every ten seconds it samples:

- MCP and owned-child PIDs;
- RSS and handle counts;
- listening ports owned by the process tree;
- active sessions and in-flight tool calls;
- overlay and branded-cursor state;
- completed, failed, denied, and timed-out calls;
- per-operation latency.

The executor writes checkpoints throughout the run and always invokes cleanup
in a bounded `finally` path. Cleanup performs a second process/port/overlay
probe. A run without a cleanup probe is invalid.

### 4.3 Real Application Harness

The harness uses this lifecycle:

```text
discover -> plan -> isolated workspace -> start managed control
-> observe -> act -> verify application state -> cleanup -> seal evidence
```

Application entries have one of three roles:

- `required-fixture`: reproducible Tier A application or public fixture;
- `installed-evidence`: Tier B software discovered on the executing machine;
- `policy-only`: an application used only to prove a privacy or danger policy.

Each application has a dedicated adapter with five responsibilities:

1. discover the executable and record its file version and SHA-256;
2. create an isolated temporary document or workspace;
3. start the application without opening recent or user-owned content;
4. perform a harmless flow and verify final application or file state;
5. close the application and remove all temporary state.

Observation capture hides the user-only overlay before capture and restores it
after capture. A successful click or tool response is not sufficient evidence;
the adapter must verify a resulting accessibility value, window state, or exact
temporary-file content.

### 4.4 Perception Corpus Runner

The perception runner consumes immutable corpus manifests and invokes the
actual released OCR, SOM, template, and proposal providers. Reports cannot be
built from hard-coded latency or accuracy arrays.

Two corpus tiers exist:

- a deterministic quick subset generated or stored for PR validation;
- a complete benchmark pack used by nightly and release-candidate validation.

The complete pack contains at least:

- 400 OCR UI regions: 150 Chinese, 150 English, 50 numeric, and 50 mixed;
- 200 Canvas, self-drawn, CAD-like, and timeline scenes;
- at least eight application classes;
- 100%, 125%, and 150% DPI coverage;
- light and dark theme coverage;
- exact labels, actionable target boxes, ignored regions, licenses, source
  classification, generator version, and SHA-256 identities.

Every sample result records provider selection, model identity, input region,
normalized output, confidence, duration, expected labels or boxes, and the
decision to act or return `observation.insufficient`.

## 5. Application Coverage

### 5.1 Tier A Required Coverage

All Tier A entries must pass before Commercial 1.0 promotion:

- Windows Notepad;
- Native Computer Use Lab;
- public WPF fixture;
- public Qt fixture;
- local Edge and Chrome HTML fixtures;
- browser Canvas fixture;
- self-drawn Skia or ImGui fixture;
- CAD-like fixture;
- video-editor timeline fixture.

Missing WPF, Qt, Skia/ImGui, CAD-like, and timeline binaries are delivered as a
separate hash-locked test fixture pack. The fixture pack is not part of either
public npm package or the complete end-user offline ZIP.

### 5.2 Initial Tier B Installed Coverage

The first machine evidence set uses software already installed on the test
machine:

- Microsoft Edge and Google Chrome;
- Visual Studio Code;
- LibreOffice Writer, Calc, Impress, and Draw;
- WPS Office as a second Office implementation;
- WeChat and WeCom as policy-only privacy-window samples.

WeChat and WeCom adapters may identify the application window and verify policy
blocking only. They must not enter conversations, read contacts, capture
message content, or persist any user-region pixels.

CAD and video-editing software are recorded as `not-installed` on this machine.
That status does not count as coverage. The corresponding interaction
mechanisms remain required through public Tier A fixtures.

## 6. Result Vocabulary

Every scenario returns exactly one status:

- `pass`: the real action and final state were verified;
- `product-failure`: the MCP, provider, overlay, policy, or cleanup behavior was
  incorrect;
- `insufficient-perception`: observation was insufficient and the system
  correctly refused to guess an action;
- `policy-blocked`: the expected safety policy denied the operation;
- `not-installed`: the target software is absent;
- `infrastructure-error`: an external runner or operating-system failure
  prevented a valid attempt.

`not-installed`, `insufficient-perception`, and `infrastructure-error` never
count as `pass`. They must remain visible in aggregate reports and cannot be
removed by changing an entry to `required: false`.

## 7. Retry and Failure Policy

- A real-application scenario may retry once only for a declared transient
  transport, timeout, or window-availability error.
- Both attempts remain in evidence.
- The same failure twice becomes `product-failure`.
- OCR or proposal confidence below the approved action threshold returns
  `observation.insufficient`; guessed-coordinate actions are forbidden.
- Evidence with missing fields, mismatched hashes, an incomplete cleanup probe,
  an incorrect duration, or an identity not matching the candidate commit is
  invalid and fails closed.
- A scheduled run may be retried as a new run, but a passing retry does not
  delete or replace the failed evidence.

## 8. Approved Commercial Targets

### 8.1 Runtime Stability

| Gate | Duration | Purpose |
| --- | ---: | --- |
| Pull request | 15 minutes | Real daemon, concurrency, faults, and cleanup |
| Nightly | 2 hours | Sustained resources, reconnects, and trend evidence |
| Release candidate | 8 hours | Candidate-bound commercial stability evidence |

Every gate requires:

- RSS net growth at or below 128 MiB;
- handle net growth at or below 128;
- zero orphan processes;
- zero residual owned listening ports;
- zero overlay or branded-cursor leaks;
- tool-call failure rate below 0.1%;
- every safety-policy error to fail closed.

Reports also include peak usage and linear RSS/handle growth slopes so a final
garbage collection cannot hide sustained growth.

### 8.2 OCR

- normalized character accuracy at or above 97%;
- critical action-label recall at or above 95%;
- warm small-crop P95 at or below 200 ms;
- ordinary-window-region P95 at or below 300 ms;
- first full-window diagnostic at or below 1,000 ms;
- full-window OCR remains forbidden in the normal action loop.

### 8.3 Complex Visual Perception

- actionable proposal precision at or above 98%;
- actionable proposal recall at or above 90%;
- zero guessed-coordinate actions;
- every low-confidence action candidate becomes
  `observation.insufficient`.

## 9. Privacy and Artifact Policy

- The repository may contain generated fixtures, public fixtures, annotations,
  and licenses only.
- Real installed-application runs operate exclusively on runner-created
  temporary documents and workspaces.
- Complete real-application window and desktop captures are destroyed after
  region extraction and are never added to evidence.
- A retained crop must pass deterministic redaction and content classification
  before hashing and storage.
- User documents, recent-file lists, conversations, contacts, credentials,
  payment data, and password fields are forbidden inputs.
- Reports contain relative logical identifiers, never user-profile paths.
- The privacy scanner fails the run before evidence sealing if forbidden
  metadata or pixel classifications are detected.

## 10. Commercial 1.0 Promotion Gate

A candidate is eligible only when all of the following evidence matches the
same Git commit, core package, platform package, driver, overlay, OCR runtime,
and model pack:

1. all Tier A entries pass;
2. at least one installed application passes in each of Browser, Electron,
   Office, and Complex Canvas categories;
3. absent industrial software is explicitly reported and the CAD-like and
   timeline Tier A fixtures meet the perception targets;
4. the complete OCR and complex-visual corpus meets every approved metric;
5. valid 15-minute, 2-hour, and 8-hour soak evidence exists;
6. all cleanup, privacy, and package-identity checks pass;
7. every failed run remains discoverable and no newer passing run silently
   overwrites it.

The aggregator produces `eligible: true` only from verified evidence. It does
not execute tests, download assets, infer missing fields, or accept manually
edited summaries.

## 11. Workflow Ownership

- Pull-request CI runs the deterministic unit/integration suites, the quick
  perception corpus, Tier A fixtures available on the runner, and the real
  15-minute soak.
- A scheduled Windows workflow runs the complete corpus, available Tier B
  adapters, and the two-hour soak.
- The eight-hour release-candidate command runs on an explicitly prepared local
  or self-hosted Windows machine and writes a portable evidence directory.
- A separate verification command validates imported release-candidate
  evidence before promotion.
- Ordinary package installation and MCP runtime never download benchmark or
  fixture packs.

## 12. Test Strategy

Development follows red-green-refactor for every behavior change.

### Unit Tests

- evidence schema, path, identity, checksum, and privacy validation;
- percentile, accuracy, precision, recall, failure-rate, net-growth, peak, and
  slope calculations;
- status aggregation and anti-optional-gaming rules;
- retry classification and attempt retention;
- promotion-gate identity and duration validation.

### Local Integration Tests

- official MCP SDK against a real stdio daemon;
- real overlay and cursor lifecycle around capture and cancellation;
- real fixture applications and exact temporary-file verification;
- released ONNX OCR and perception providers against the quick corpus;
- process, port, and handle cleanup after injected faults.

Windows process ownership is identity- and time-bound. A root is identified by
PID plus process creation time (or a bounded retirement time), and a descendant
is owned only when its creation time is not earlier than its matched parent.
Bare historical PIDs and PPID equality alone are invalid evidence because
Windows may reuse a PID while older processes retain that numeric PPID.

### Environment Evidence

- installed application discovery and adapter flows;
- two-hour and eight-hour soak execution;
- complete OCR and complex-visual corpus;
- privacy scanner and evidence sealing;
- evidence import and Commercial 1.0 aggregation.

Unit tests may use short deterministic durations to test calculation and error
paths. They cannot produce environment evidence, and the evidence verifier
rejects a report whose requested or measured duration is below its gate.

## 13. Component Boundaries

Implementation keeps these responsibilities separate:

- `commercial-evidence`: run manifests, event writing, sealing, and verification;
- `commercial-metrics`: deterministic metric and threshold calculation;
- `runtime-soak`: real MCP sessions, fault plans, process sampling, and cleanup;
- `app-adapters`: discovery and harmless app-specific flows;
- `perception-corpus`: manifests, generators, labels, and privacy checks;
- `perception-benchmark`: provider execution and per-sample results;
- `commercial-promotion`: read-only aggregation of previously verified evidence.

No component receives a raw GitHub, Gitee, npm, or application credential.
No benchmark component may start Gateway-managed desktop control unless its
scenario explicitly requires an action and has an active control lease.

## 14. Completion Definition

This design is complete only when the five staged changes are merged, their
tests pass, and a candidate has produced all Commercial 1.0 evidence described
in Section 10. Passing unit tests or publishing an npm preview version alone is
not sufficient.
