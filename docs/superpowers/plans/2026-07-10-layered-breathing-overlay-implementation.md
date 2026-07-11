# Layered Breathing Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the production Windows per-pixel-alpha breathing overlay and make its branded cursor follow the active Gateway-managed control lease without leaking after MCP shutdown.

**Architecture:** The native helper separates deterministic theme/geometry, bitmap composition, and Win32 layered-window presentation. Snapshot mode invokes the same compositor as the desktop window. The MCP driver owns the underlying cua-driver session, while the provider router explicitly starts and stops cursor visibility with the active control lease and performs best-effort cleanup on every terminal path.

**Tech Stack:** .NET 10 Windows Forms, System.Drawing 32-bit premultiplied ARGB, Win32 `UpdateLayeredWindow`, Node.js ESM, official MCP SDK, Node test runner.

## Global Constraints

- Windows x64 is the only release target enabled in this phase.
- Visible wave thickness is always between 18 and 36 logical pixels.
- The breathing period is exactly 3.2 seconds.
- Fill alpha is always between 0.14 and 0.32.
- Family colors are clay `#D97757`, clay deep `#B8593B`, and clay soft `#F7D2C3`.
- White is allowed only as a low-alpha current highlight, never as a dominant gradient endpoint.
- Overlay pixels remain excluded from agent observation independently of visual alpha.
- No WebView2 dependency or fallback may be introduced.
- The Windows x64 offline release limit remains 310 MiB.

---

### Task 1: Freeze The Native Rendering Contract

**Files:**
- Modify: `test/gateway-run.test.mjs`
- Create: `test/gateway-overlay-snapshot.test.mjs`
- Modify: `gateway-overlay/Program.cs`

**Interfaces:**
- Consumes: `GatewayComputerUseOverlay.exe` built from the existing project.
- Produces: CLI `--snapshot <png> --width <int> --height <int> --phase <double>` where phase is normalized to `[0,1)`.

- [ ] **Step 1: Write failing source-contract tests**

Update `test/gateway-run.test.mjs` so the native helper must contain `WS_EX_LAYERED`, `UpdateLayeredWindow`, `AC_SRC_ALPHA`, `Format32bppPArgb`, `MinWaveThickness = 18`, `MaxWaveThickness = 36`, `BreathPeriodMilliseconds = 3200`, and no `TransparencyKey`.

```js
assert.match(program, /WS_EX_LAYERED/);
assert.match(program, /UpdateLayeredWindow/);
assert.match(program, /AC_SRC_ALPHA/);
assert.match(program, /Format32bppPArgb/);
assert.match(program, /MinWaveThickness = 18/);
assert.match(program, /MaxWaveThickness = 36/);
assert.match(program, /BreathPeriodMilliseconds = 3200/);
assert.doesNotMatch(program, /TransparencyKey/);
```

- [ ] **Step 2: Write a failing executable snapshot test**

Create `test/gateway-overlay-snapshot.test.mjs` that builds the project once, invokes phases `0`, `0.25`, and `0.5`, validates PNG signature and IHDR dimensions, and requires three non-empty, pairwise-distinct files.

```js
for (const phase of [0, 0.25, 0.5]) {
  await run(overlayExe, ["--snapshot", output, "--width", "640", "--height", "400", "--phase", String(phase)]);
  const png = await readFile(output);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 400);
  assert.ok(png.length > 1_000);
}
assert.equal(new Set(hashes).size, 3);
```

- [ ] **Step 3: Run the tests and verify RED**

Run: `node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs`

Expected: FAIL because the current renderer uses `TransparencyKey`, 8-16px constants, and has no snapshot CLI.

- [ ] **Step 4: Add only CLI argument parsing and a deliberate unsupported snapshot result**

Change `Main` to accept `string[] args`, parse the exact argument names, validate positive dimensions and finite phase, and route snapshot requests to a compositor API introduced in Task 2. Invalid arguments exit non-zero with a concise error written to stderr.

- [ ] **Step 5: Commit the RED contract**

```powershell
git add test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs gateway-overlay/Program.cs
git commit -m "test: freeze layered overlay rendering contract"
```

### Task 2: Implement The Shared Breathing Compositor

**Files:**
- Create: `gateway-overlay/OverlayTheme.cs`
- Create: `gateway-overlay/OverlayRenderer.cs`
- Modify: `gateway-overlay/Program.cs`
- Test: `test/gateway-overlay-snapshot.test.mjs`

**Interfaces:**
- Produces: `OverlayFrameState AtPhase(double phase)` containing `Breath`, `BaseThickness`, and `FillAlpha`.
- Produces: `Bitmap Render(Size size, double phase, RectangleF? targetRect)` using `PixelFormat.Format32bppPArgb`.
- Consumes: the snapshot CLI from Task 1 and the desktop form from Task 3.

- [ ] **Step 1: Extend the failing snapshot test with exact theme and phase evidence**

Require source constants for all three colors and exact bounds, then use snapshot file hashes to prove minimum, midpoint, and maximum phases do not collapse to the same frame.

```js
assert.match(theme, /Color\.FromArgb\(217, 119, 87\)/);
assert.match(theme, /Color\.FromArgb\(184, 89, 59\)/);
assert.match(theme, /Color\.FromArgb\(247, 210, 195\)/);
assert.match(theme, /MinFillAlpha = 0\.14/);
assert.match(theme, /MaxFillAlpha = 0\.32/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/gateway-overlay-snapshot.test.mjs`

Expected: FAIL because `OverlayTheme.cs` and the shared compositor do not exist.

- [ ] **Step 3: Implement deterministic theme state**

Implement the approved formulas without wall-clock access in `OverlayTheme.cs`:

```csharp
var normalized = phase - Math.Floor(phase);
var breath = 0.5 - 0.5 * Math.Cos(2 * Math.PI * normalized);
var baseThickness = 23 + (31 - 23) * breath;
var fillAlpha = MinFillAlpha + (MaxFillAlpha - MinFillAlpha) * breath;
```

- [ ] **Step 4: Implement the shared compositor**

Create the premultiplied ARGB bitmap, draw one even-odd closed river, use bounded three-frequency local harmonics, blend clay/deep/soft family layers, add only low-alpha white current highlights, and render the target frame using the same breath state. Every `Bitmap`, `Graphics`, `GraphicsPath`, `Brush`, and `Pen` is disposed deterministically.

- [ ] **Step 5: Connect snapshot mode to the compositor**

Render the requested phase with `OverlayRenderer.Render(...)`, create the parent directory, and save PNG with `ImageFormat.Png`. Snapshot mode must not instantiate `OverlayForm` or start desktop control.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node --test test/gateway-overlay-snapshot.test.mjs`

Expected: PASS with three 640x400 PNG files and distinct hashes.

- [ ] **Step 7: Commit the shared compositor**

```powershell
git add gateway-overlay/OverlayTheme.cs gateway-overlay/OverlayRenderer.cs gateway-overlay/Program.cs test/gateway-overlay-snapshot.test.mjs
git commit -m "feat: add deterministic breathing overlay compositor"
```

### Task 3: Present Frames Through A Per-Pixel-Alpha Layered Window

**Files:**
- Create: `gateway-overlay/LayeredWindowPresenter.cs`
- Modify: `gateway-overlay/Program.cs`
- Test: `test/gateway-run.test.mjs`

**Interfaces:**
- Produces: `void Present(Form window, Bitmap frame, Point screenLocation)`.
- Consumes: `OverlayRenderer.Render(...)` and virtual-screen bounds.

- [ ] **Step 1: Run the existing source contract and verify it remains RED**

Run: `node --test test/gateway-run.test.mjs`

Expected: FAIL because desktop presentation still uses WinForms paint/color-key composition.

- [ ] **Step 2: Implement native frame presentation**

Use `GetDC`, `CreateCompatibleDC`, `SelectObject`, `GetHbitmap`, and `UpdateLayeredWindow` with this blend contract:

```csharp
var blend = new BLENDFUNCTION {
    BlendOp = AC_SRC_OVER,
    SourceConstantAlpha = 255,
    AlphaFormat = AC_SRC_ALPHA,
};
```

Restore the previous selected GDI object and release/delete every HDC/HBITMAP in `finally`. Throw `Win32Exception` when `UpdateLayeredWindow` fails.

- [ ] **Step 3: Replace the paint loop with layered updates**

Add `WS_EX_LAYERED` to `CreateParams`, remove `BackColor`, `TransparencyKey`, `DoubleBuffered`, `OnPaintBackground`, and `OnPaint`, and have the 33ms timer render the current phase from `_animationClock.Elapsed.TotalMilliseconds / 3200.0` before presenting it. Preserve click-through, no-activate, tool-window, topmost, virtual-screen, target tracking, and no-activate target raising.

- [ ] **Step 4: Run build and focused tests**

Run: `dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo`

Run: `node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs`

Expected: build succeeds and both test files pass.

- [ ] **Step 5: Commit the layered presenter**

```powershell
git add gateway-overlay/LayeredWindowPresenter.cs gateway-overlay/Program.cs test/gateway-run.test.mjs
git commit -m "feat: present overlay with per-pixel alpha"
```

### Task 4: Bind Cursor Visibility To The Active Control Lease

**Files:**
- Modify: `src/cua-driver-mcp-driver.mjs`
- Modify: `src/computer-use-provider-router.mjs`
- Modify: `src/computer-use-mcp-server.mjs`
- Modify: `test/cua-driver-mcp-driver.test.mjs`
- Modify: `test/phase-1-10-controller-timeout.test.mjs`
- Modify: `test/phase-1-12-control-approval-state.test.mjs`
- Modify: `test/phase-5-2-disconnect-cleanup.test.mjs`

**Interfaces:**
- Produces: `CuaDriverMcpDriver.startCursor(): Promise<void>`.
- Produces: `CuaDriverMcpDriver.stopCursor(): Promise<void>`.
- Produces: router-internal `stopControlVisuals(): Promise<void>`.
- Produces: terminal `open`, `closing`, and `closed` lifecycle barriers for
  router, driver, OCR startup, and the cua-driver MCP client.
- Consumes: existing `DEFAULT_AGENT_CURSOR_STYLE` and cua-driver MCP tools.

- [ ] **Step 1: Write failing driver lifecycle tests**

Require observe-only `findWindow` to start a session without enabling the cursor; `startCursor` must style then enable; `stopCursor` must disable once; `close` must defensively disable before `end_session`; repeated cleanup is idempotent. Add cases where style startup fails and where disable fails, proving subsequent cleanup calls still run.

- [ ] **Step 2: Write failing router terminal-path tests**

Add `startCursor` and `stopCursor` spies. Require grant order `cursor.start`, `overlay.start`; release order `overlay.stop`, `cursor.stop`; and the same stop behavior for cancel, revoke, lease timeout, disconnect/close, and overlay-start rollback.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs`

Expected: FAIL because cursor visibility is currently enabled by `ensureStarted()` and is never disabled.

- [ ] **Step 4: Implement staged, idempotent driver state**

Track client/session/cursor state independently. `ensureStarted()` starts only client and session. `startCursor()` applies family style before enabling. `stopCursor()` disables only when needed. `close()` attempts cursor disable, session end, and client close even if a previous stage fails, then clears all local state.

- [ ] **Step 5: Implement router visual lifecycle and rollback**

Start cursor before overlay only after approval/grant. On partial grant failure, clear `activeController`, stop any overlay handle, and stop cursor before rethrowing the original error. Replace terminal-path `stopOverlay()` calls with a helper that always attempts overlay then cursor cleanup.

- [ ] **Step 6: Add stdio EOF cleanup**

Make server shutdown idempotent and call it when stdin reaches `end` or `close`, in addition to SIGINT, SIGTERM, uncaught exception, and explicit router close. Ensure one shutdown trigger cannot skip router cleanup or start a second cleanup race.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `node --test test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs`

Expected: all focused tests pass with disable-before-end ordering.

- [ ] **Step 8: Commit cursor and shutdown lifecycle**

```powershell
git add src/cua-driver-mcp-driver.mjs src/computer-use-provider-router.mjs src/computer-use-mcp-server.mjs test/cua-driver-mcp-driver.test.mjs test/phase-1-10-controller-timeout.test.mjs test/phase-1-12-control-approval-state.test.mjs test/phase-5-2-disconnect-cleanup.test.mjs
git commit -m "fix: bind branded cursor to control lease"
```

- [ ] **Step 9: Write failing reverse-interleaving lifecycle tests**

Use deferred gates to require close to win when it begins before grant
registration, during driver `findWindow`, during OCR startup, and during MCP
client close. Assert that no controller, cursor, overlay, session, OCR process,
or transport survives and that new work rejects after `closing` begins.

- [ ] **Step 10: Replace independent booleans with terminal barriers**

Register work synchronously before its first await, invalidate grant
generations on close, serialize all driver transitions, share OCR startup, and
coalesce client start/close. Publish state only while the operation ticket is
still current. Retain failed cleanup resources for close retry.

- [ ] **Step 11: Run lifecycle and standard MCP verification**

Run the focused lifecycle suite followed by standard SDK client/server,
multi-client, and stress tests. Expected: all pass without active handles,
listener growth, forced process exit, or post-close restart.

- [ ] **Step 12: Commit terminal lifecycle hardening**

```powershell
git add src test docs/superpowers/specs/2026-07-10-overlay-breathing-and-cursor-cleanup-design.md docs/superpowers/plans/2026-07-10-layered-breathing-overlay-implementation.md
git commit -m "fix: enforce terminal computer use lifecycle"
```

### Task 5: Align The Browser Reference And Produce Visual Evidence

**Files:**
- Modify: `public/wave-overlay.mjs`
- Modify: `public/styles.css`
- Modify: `test/computer-use-mode.test.mjs`
- Create: `artifacts/overlay-visual/min.png` (ignored evidence)
- Create: `artifacts/overlay-visual/mid.png` (ignored evidence)
- Create: `artifacts/overlay-visual/max.png` (ignored evidence)

**Interfaces:**
- Consumes: approved native constants and family tokens.
- Produces: reference demo constants `{ min: 18, rest: 27, max: 36 }`, 3.2s cycle, and 0.14-0.32 alpha envelope.

- [ ] **Step 1: Update the browser contract test first**

Change expected thickness values to 18/27/36 and require the 3.2s breathing period and approved alpha endpoints.

- [ ] **Step 2: Run and verify RED**

Run: `node --test test/computer-use-mode.test.mjs`

Expected: FAIL against the old 8/12/16 reference implementation.

- [ ] **Step 3: Align browser reference tokens and motion**

Update the canvas/CSS reference to the same palette and numerical envelope. Keep it a reference only; the native compositor remains the release source of truth.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test test/computer-use-mode.test.mjs`

Expected: PASS.

- [ ] **Step 5: Generate production-compositor visual evidence**

```powershell
dotnet run --project gateway-overlay/GatewayComputerUseOverlay.csproj -- --snapshot artifacts/overlay-visual/min.png --width 1152 --height 720 --phase 0
dotnet run --project gateway-overlay/GatewayComputerUseOverlay.csproj -- --snapshot artifacts/overlay-visual/mid.png --width 1152 --height 720 --phase 0.25
dotnet run --project gateway-overlay/GatewayComputerUseOverlay.csproj -- --snapshot artifacts/overlay-visual/max.png --width 1152 --height 720 --phase 0.5
```

- [ ] **Step 6: Commit reference parity**

```powershell
git add public/wave-overlay.mjs public/styles.css test/computer-use-mode.test.mjs
git commit -m "feat: align overlay reference with breathing theme"
```

### Task 6: Verify Desktop Runtime And Rebuild Release Evidence

**Files:**
- Modify only if verification exposes a defect covered by a new failing test.
- Regenerate ignored release output under `artifacts/windows-release/0.0.1`.

**Interfaces:**
- Consumes: completed native helper, MCP lifecycle, and Windows release assembly.
- Produces: fresh test/build/smoke/release evidence bound to the final branch commit.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run native and product gates**

```powershell
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --configuration Release --nologo
npm run phase:0.14
npm run phase:0.15
npm run release:windows:size-report
npm run phase:7.8
npm run phase:7.9
npm audit --omit=dev
```

Expected: every command exits 0, the offline ZIP remains below 310 MiB, and audit reports zero vulnerabilities.

- [ ] **Step 3: Run a real overlay process smoke**

Launch the built helper, verify it stays responsive for at least one full 3.2s breathing cycle, record CPU and working set, terminate it, and verify no overlay process remains.

- [ ] **Step 4: Run the real MCP/cua-driver cleanup smoke**

Start a Gateway-managed control lease, verify overlay and branded cursor become visible, close the standard MCP client transport, and verify overlay process plus rendered cursor disappear without manual cleanup.

- [ ] **Step 5: Inspect the three PNGs and show the real animation**

Use the local image viewer for min/mid/max snapshots, then launch the native overlay so the user can confirm the actual 18-36px, 3.2s, 0.14-0.32 breathing effect.

- [ ] **Step 6: Review diff and commit any verification-only fixes through RED/GREEN**

Run: `git diff --check && git status --short --branch`

Expected: no whitespace errors and only intentional changes.
