# Layered Breathing Overlay And Cursor Cleanup

Status: design parameters approved; pending written-spec review

Date: 2026-07-10

## Context

The native Windows overlay removed the release-time WebView2 dependency, but
the first implementation uses `TransparencyKey`. GDI+ alpha is flattened into
the color-keyed form before Windows composition, so partially transparent
pixels do not preserve the intended family colors. The current 8-16px band is
also too narrow for the active Computer Use affordance and its motion reads as
traveling noise rather than a slow breathing state.

The cua-driver lifecycle has a separate cleanup defect. Startup enables the
agent cursor, but driver shutdown calls only `end_session`. The cursor is
driver-process state and can remain rendered after the MCP server exits.

## Decisions

1. Replace `TransparencyKey` rendering with a Windows per-pixel-alpha layered
   window updated through `UpdateLayeredWindow`.
2. Keep `WS_EX_TRANSPARENT`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, topmost
   placement, virtual-screen coverage, and target-window no-activate behavior.
3. Render one closed river path. Four independent edge bands are forbidden.
4. Visible thickness stays within 18-36 logical pixels.
5. One breathing cycle is 3.2 seconds. A smooth cosine envelope modulates both
   the mean thickness and opacity; local wave harmonics remain secondary.
6. Fill opacity breathes between 0.14 and 0.32. This affects only the user's
   view; observation exclusion remains mandatory and must not depend on alpha.
7. The family palette is fixed to the existing shared tokens:
   - clay: `#D97757`
   - clay deep: `#B8593B`
   - clay soft: `#F7D2C3`
8. White may be used only as a low-alpha current highlight. It must not be a
   gradient endpoint that changes the dominant family color.
9. The target frame uses the same palette and breath envelope, with a bounded
   translucent glow and no opaque window fill.
10. The overlay binary exposes an internal deterministic snapshot command that
    renders the production compositor to PNG without starting desktop control.
11. Driver shutdown disables the agent cursor before ending the session.
12. Cursor disable, session end, and client close are independent best-effort
    cleanup stages. Failure in one stage must not skip the following stages.
13. A partially failed startup rolls back any cursor or session state already
    created before reporting the original startup failure.
14. Cleanup is idempotent across revoke, cancel, timeout, disconnect, SIGINT,
    SIGTERM, uncaught exception, and explicit router close.
15. Cursor visibility belongs to an active Gateway-managed control lease, not
    to generic driver initialization. Observe-only calls may start the driver
    session but must not enable the rendered cursor.
16. Router, driver, OCR startup, and the cua-driver MCP client use an explicit
    terminal lifecycle: `open -> closing -> closed`. Entering `closing` is
    synchronous and permanently rejects new work for that instance.
17. Every asynchronous startup is registered before its first `await`.
    Shutdown invalidates pending grants, waits for registered startup work to
    settle, then cleans any resource that startup created.
18. A controller is published only after its permitted cursor state and user
    overlay are fully started and its grant generation remains current.
19. Driver session, cursor, action, and close transitions share one serialized
    lifecycle queue. No operation may reconnect or recreate a session after
    close begins.
20. OCR startup has one shared startup promise. Router close waits for it and
    closes the sidecar if startup completed, including completion after close
    was requested.
21. The cua-driver MCP client coalesces concurrent start and close calls.
    `start()` waits for an in-progress close and then rejects because the
    client is terminally closed; it never reports success for a removed
    transport.

## Rendering Model

For normalized breath phase `p`:

```text
breath(p) = 0.5 - 0.5 * cos(2 * PI * p)
baseThickness = lerp(23, 31, breath)
thickness = clamp(baseThickness + localWave * 5, 18, 36)
fillAlpha = lerp(0.14, 0.32, breath)
```

`localWave` is the existing bounded three-frequency harmonic in `[-1, 1]`.
The breath envelope changes slowly and uniformly around the perimeter; the
harmonics supply spatial water motion without destroying the breathing read.

The renderer creates a 32-bit premultiplied ARGB bitmap for the virtual-screen
bounds, draws the closed even-odd path and target frame into that bitmap, and
commits it with `UpdateLayeredWindow`, `AC_SRC_OVER`, and `AC_SRC_ALPHA`.

## Observation Boundary

The overlay remains user-only:

- screenshot capture hides or excludes it before acquiring pixels;
- OCR and diff inputs never use overlay-composited pixels;
- traces and artifacts reject overlay payloads;
- alpha is a visual affordance, not an observation safety mechanism.

The enlarged 18-36px band therefore does not reduce agent recognition quality.

## Cursor Lifecycle

Driver session startup order:

```text
client.start
start_session
```

Active control acquisition order:

```text
set_agent_cursor_style(family tokens)
set_agent_cursor_enabled(true)
start overlay
```

Active control release order:

```text
stop overlay
set_agent_cursor_enabled(false)
```

Driver shutdown order:

```text
set_agent_cursor_enabled(false)
end_session
client.close
```

Driver shutdown repeats cursor disable defensively, because an abnormal control
release must not leave process-global cursor state behind. Each shutdown call
executes even when the previous call fails. Session and control startup record
which stages completed and run the corresponding reverse cleanup before
rethrowing the original startup error.

## Terminal Lifecycle Barrier

The lifecycle barrier is fail-closed. Public work calls synchronously acquire
an operation ticket while the owner is `open`. `close()` synchronously changes
the owner to `closing`, invalidates every pending grant generation, and then
waits for admitted operations to settle. Operations check their ticket after
each external await and before publishing state. An invalid ticket performs
reverse cleanup and returns a lifecycle-closed error.

Successful close changes the owner to `closed`. Cleanup failure leaves it in
`closing` with failed resources retained, so a later `close()` retries cleanup;
new work remains forbidden. Concurrent close calls share the same attempt.

## Verification

- Unit tests freeze 18-36px, 3.2s, 0.14-0.32, and the three family colors.
- Cursor tests require disable-before-end ordering, idempotent close, cleanup
  after a failed style call, and continued cleanup after a disable failure.
- Router tests verify cancel, revoke, lease timeout, disconnect, and close stop
  both overlay and cursor state.
- The overlay builds with zero WebView2 references.
- Deterministic snapshots are inspected at breath minimum, midpoint, and
  maximum before the real desktop animation is shown.
- A real overlay process smoke verifies startup, responsiveness, and shutdown.
- Release payload, Phase 0.15, size report, and complete test suite are rerun.

## Non-Goals

- The overlay does not enter agent observations.
- No WebView2 fallback is added.
- No theme picker or arbitrary user color configuration is added in this phase.
- The 310 MiB Windows x64 release limit does not change.
