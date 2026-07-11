# Task 4 Report: Cursor And Shutdown Lifecycle

## RED Evidence

Command:

```powershell
node --test test/cua-driver-mcp-driver.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 6`, `fail 3`.

- Cursor disable was attempted only once after a transient release failure, proving `stopCursor()` cleared its retry state before remote success.
- The SDK client close was attempted only once after a transient failure, proving `CuaDriverMcpClient.close()` cleared `started` before remote success.
- A shutdown completed with exit code 0 did not upgrade to 1 when a later fatal trigger arrived.

## GREEN Evidence

Focused lifecycle command:

```powershell
node --test test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 21`, `fail 0` in 1.46 seconds.

Expanded MCP compatibility command:

```powershell
node --test test/computer-use-mcp.test.mjs test/computer-use-provider-router.test.mjs test/server-smoke.test.mjs test/phase-1-7-standard-mcp-client.test.mjs test/phase-1-8-standard-mcp-server.test.mjs test/phase-5-1-multi-client.test.mjs test/phase-5-6-mcp-stress.test.mjs
```

Result: `pass 13`, `fail 0` in 1.99 seconds.

## Implementation

- Driver initialization now starts only the client and cua-driver session.
- Explicit cursor startup applies the shared family style before enabling rendering.
- Cursor disable, session end, and client close retain retry state until their remote operation succeeds.
- Observe-only window discovery never enables the rendered cursor.
- Router grant starts cursor then overlay and rolls both back on partial startup failure.
- Cancel, revoke, lease timeout, disconnect, and close stop overlay before cursor and continue independent cleanup stages after failures.
- MCP shutdown coalesces stdin end/close, signals, and uncaught exceptions without synchronous `process.exit()`.
- A fatal trigger received after completed graceful shutdown upgrades the process exit code.

## Changed Files

- `src/cua-driver-mcp-driver.mjs`
- `src/computer-use-provider-router.mjs`
- `src/computer-use-mcp-server.mjs`
- `test/cua-driver-mcp-driver.test.mjs`
- `test/phase-1-10-controller-timeout.test.mjs`
- `test/phase-1-12-control-approval-state.test.mjs`
- `test/phase-4-1-overlay-theme-cursor-tokens.test.mjs`
- `test/phase-5-2-disconnect-cleanup.test.mjs`

## Self-Review

- State transitions occur after remote success, so failed cleanup remains retryable.
- Successful client process closure clears dependent session and cursor state because the process-global rendering state can no longer survive.
- First errors are preserved while later cleanup stages are still attempted.
- Server modules remain importable for unit tests and execute only as the direct entry or verified protected runtime.
- No public MCP tool schema or observation payload changed.

## Concerns

The ignored Phase 0.15 release candidate still predates the branch commits and must be rebuilt in Task 6 before the full suite can pass its commit-bound identity check.

## Review Fix: Async Lifecycle Races

### RED

Command:

```powershell
node --test test/task-4-lifecycle-races.test.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result from clean head `270baf6`: `pass 21`, `fail 15`.

- Cancel, revoke, timeout, and disconnect could all race cursor or overlay startup and reject with a null-controller `TypeError` after leaving startup work alive.
- Observe access started and stopped the control cursor.
- Concurrent and repeated router close duplicated asset, cursor, and driver cleanup; failed overlay and OCR cleanup could not retry.
- Concurrent driver cursor teardown duplicated disable; concurrent SDK client startup duplicated connect; failed connect leaked its retained transport.
- Shutdown handler registration did not return cleanup and all five listeners remained registered.

### GREEN

Focused lifecycle command:

```powershell
node --test test/task-4-lifecycle-races.test.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 36`, `fail 0` in 1.93 seconds.

Standard MCP compatibility command:

```powershell
node --test test/computer-use-mcp.test.mjs test/computer-use-provider-router.test.mjs test/server-smoke.test.mjs test/phase-1-7-standard-mcp-client.test.mjs test/phase-1-8-standard-mcp-server.test.mjs test/phase-5-1-multi-client.test.mjs test/phase-5-6-mcp-stress.test.mjs
```

Result: `pass 13`, `fail 0` in 1.64 seconds.

### Fix

- Grant generations are invalidated synchronously by every terminal path and checked after each awaited startup stage; controllers are published only after visuals finish successfully.
- Router visual and close lifecycles are serialized, coalesced, idempotent, and retryable without clearing overlay or OCR state before remote cleanup succeeds.
- Observe access retains the user safety overlay while never enabling the control cursor.
- Driver cursor start, stop, and close are serialized. SDK client start and close coalesce, and failed connect transports remain available for cleanup.
- Shutdown registration returns an idempotent unregister callback, shutdown invokes it, listener counts return to zero, and the actual child-process stdin EOF regression remains covered.

Fix commit: `fix: harden Task 4 async lifecycle cleanup` (this commit).

### Review Fix Self-Review

- First operational errors remain authoritative while independent cleanup stages continue.
- Successful cleanup stages are not repeated after a partial close failure; failed stages retain enough state to retry.
- The public `computer.*` tool schemas, result envelopes, observation payloads, and overlay exclusion policy are unchanged.
- No new runtime dependency, binary, model, platform assumption, or user-visible overlay behavior was introduced.

### Review Fix Concerns

No new Task 4 concerns. The pre-existing ignored Phase 0.15 release-candidate identity concern above remains owned by Task 6.

## Terminal Lifecycle Barrier Addendum

### RED

Command:

```powershell
node --test test/task-4-lifecycle-races.test.mjs
```

Result from clean head `8e03f23`: `pass 10`, `fail 7` in 0.50 seconds.

- Close before `requestAccess()` grant registration still allowed a controller to publish.
- Close during `findWindow()` returned the old controller error instead of the terminal lifecycle error.
- Concurrent OCR startup was duplicated and completed without terminal rejection or guaranteed close.
- Driver `findWindow()` and action work could resolve after session teardown and reconnect after close.
- MCP client startup could resolve across close, and startup during a failed close could reconnect.
- A failed router close still admitted new controller work.

### GREEN

Focused lifecycle command:

```powershell
node --test test/task-4-lifecycle-races.test.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 42`, `fail 0` in 2.44 seconds.

Standard MCP compatibility command:

```powershell
node --test test/computer-use-mcp.test.mjs test/computer-use-provider-router.test.mjs test/server-smoke.test.mjs test/phase-1-7-standard-mcp-client.test.mjs test/phase-1-8-standard-mcp-server.test.mjs test/phase-5-1-multi-client.test.mjs test/phase-5-6-mcp-stress.test.mjs
```

Result: `pass 13`, `fail 0` in 1.94 seconds.

### Implementation

- Router work acquires a synchronous generation ticket while open; close enters `closing` before its first await, invalidates grants, waits admitted work, and rejects all later work with `lifecycle.closed`.
- OCR startup is one shared registered promise. Close waits for startup settlement and closes every attempted or completed sidecar, retaining failed cleanup for retry.
- Driver startup, window discovery, cursor changes, actions, and close share one serialized terminal lifecycle queue.
- The cua-driver MCP client separately tracks connected transport ownership and published startup, coalesces start/close, and cannot restart after close begins.
- Failed cleanup leaves lifecycle state `closing`; concurrent close calls share one attempt, retries retain resources, and successful close is terminal.
- Observe-tier cursor behavior and all prior Task 4 lifecycle coverage remain intact.

### Concerns

No new Task 4 concerns. The pre-existing Phase 0.15 release-candidate identity concern remains owned by Task 6.

## Remaining Important Lifecycle Review Fixes

### RED

MCP call admission command:

```powershell
node --test --test-name-pattern "MCP client close (adjudicates|waits for an admitted)" test/task-4-lifecycle-races.test.mjs
```

Result from clean head `b8423de`: `pass 0`, `fail 2`.

- A call admitted immediately before close resumed from `await start()` and
  entered the SDK while SDK close was already in progress.
- SDK close also overtook an admitted SDK tool call that had already started,
  creating a transport cleanup race.

Router checked-await command:

```powershell
node --test --test-name-pattern "router close during (OCR doctor|repair doctor)" test/task-4-lifecycle-races.test.mjs
```

Result from clean head `b8423de`: `pass 0`, `fail 2`.

- Closing during `ocr.doctor()` still started all three prewarm OCR calls.
- Closing during repair's install-cache doctor still started runtime cleanup
  inspection afterward.

### GREEN

Bounded focused lifecycle command:

```powershell
node --test --test-timeout=10000 test/task-4-lifecycle-races.test.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 46`, `fail 0` in 2.16 seconds. This preserves the previous 42
lifecycle cases and adds four gated regressions.

Bounded standard MCP compatibility command:

```powershell
node --test --test-timeout=10000 test/computer-use-mcp.test.mjs test/server-smoke.test.mjs test/phase-1-7-standard-mcp-client.test.mjs test/phase-1-8-standard-mcp-server.test.mjs test/phase-5-1-multi-client.test.mjs test/phase-5-6-mcp-stress.test.mjs
```

Result: `pass 13`, `fail 0` in 1.70 seconds.

### Implementation

- `CuaDriverMcpClient.callTool()` now acquires and registers a call ticket
  synchronously before its first await. Close enters `closing`, forbids later
  calls, drains every admitted call, and only then closes the SDK client or
  transport. Invalidated calls return `lifecycle.closed` before entering the
  SDK or after their current SDK call settles.
- Router operations share `awaitExternal(ticket, start)`, which checks before
  starting external work and immediately after it settles. Public operation
  methods thread their original ticket through health, doctor, repair, access,
  capture, action, cancellation, OCR, lease, artifact, and visual helpers.
- Late overlay startup retains only cleanup ownership, allowing the existing
  reverse cleanup to stop the handle without publishing an active controller.

### Self-Review

- Call registration occurs before `callToolOperation()` reaches `await
  start()`. Close snapshots tickets only after synchronously changing state to
  `closing`, so no new ticket can enter the drain set and start/close cannot
  wait on each other cyclically.
- Every external await reachable from a Router public operation is either
  wrapped by `awaitExternal` or occurs in an internal helper that performs the
  same ticket check before returning. Invalid tickets stop follow-on work and
  state publication; only reverse cleanup continues without a work ticket.
- Cleanup retry state, terminal `open -> closing -> closed` semantics, public
  MCP schemas, overlay exclusion, and phase smoke files are unchanged.
- No new dependency, binary, model, platform assumption, or public contract
  was introduced.

### Concerns

No new concern in the focused lifecycle or MCP gates. The pre-existing Phase
0.15 candidate identity concern remains outside this change and was not rerun
after the stop instruction. The existing Phase 5.5 smoke still reads
`listState()` after terminal close; it was not weakened or changed.

## Queue Release Deadlock Review Fix

### RED

Command from clean head `a0adf0a` after adding the regression:

```powershell
node --test --test-name-pattern "router releases a ticket-invalidated visual queue wait before queued cancel and close" test/task-4-lifecycle-races.test.mjs
```

Result: exit `1`; the one regression was cancelled by its `1000ms` test bound.

- `requestAccess()` entered and held `startCursor()`.
- `cancel()` published a queued visual tail behind that work.
- `close()` invalidated the cancel ticket before cursor release.
- Releasing the cursor left cancel waiting forever because its ticketed wait
  threw before the tail's `finally` had been entered; access cleanup and close
  then remained queued behind that unreleased tail.

### GREEN

Focused regression command:

```powershell
node --test --test-name-pattern "router releases a ticket-invalidated visual queue wait before queued cancel and close" test/task-4-lifecycle-races.test.mjs
```

Result: `pass 1`, `fail 0`, `cancelled 0` in `0.52s`; the test completed in
`9.6ms` after cursor release.

Bounded lifecycle command:

```powershell
node --test --test-timeout=10000 test/task-4-lifecycle-races.test.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-4-1-overlay-theme-cursor-tokens.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
```

Result: `pass 47`, `fail 0` in `2.53s`.

Bounded standard MCP compatibility command:

```powershell
node --test --test-timeout=10000 test/computer-use-mcp.test.mjs test/server-smoke.test.mjs test/phase-1-7-standard-mcp-client.test.mjs test/phase-1-8-standard-mcp-server.test.mjs test/phase-5-1-multi-client.test.mjs test/phase-5-6-mcp-stress.test.mjs
```

Result: `pass 13`, `fail 0` in `2.05s`.

### Implementation And Self-Review

- `runControlVisualLifecycle()` now enters its release-protected `try/finally`
  before awaiting the previous tail. A ticket invalidated while waiting still
  releases its own published tail, allowing queued cleanup and close to drain.
- The gated regression verifies that access, queued cancel, and close all
  settle after cursor release, with no active controller, overlay handle, or
  cursor state retained. It also verifies exactly one cursor stop and driver
  close with no overlay startup.
- The change is limited to the router queue primitive, the lifecycle race
  regression, and this Task 4 evidence. No public MCP schema, runtime
  dependency, or visual behavior changed.

### Concerns

No new Task 4 concern. The pre-existing ignored Phase 0.15 release-candidate
identity concern remains owned by Task 6.
