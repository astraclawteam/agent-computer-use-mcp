# Task 3 Report: Per-Pixel-Alpha Layered Window Presenter

## RED Evidence

Command:

```powershell
node --test test/gateway-run.test.mjs
```

Result: the existing source contract reported `pass 2`, `fail 1`. The desktop
overlay source did not contain `WS_EX_LAYERED` and still used the WinForms
color-key paint pipeline. This was the expected Task 3 RED result.

After the source test was updated to own the presenter boundary, the same
command remained RED with `ENOENT` for
`gateway-overlay/LayeredWindowPresenter.cs`, proving the new production
presenter was absent before implementation.

## GREEN Evidence

Commands:

```powershell
node --test test/gateway-run.test.mjs
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs
git diff --check
```

Results:

- The gateway source contract passed: `pass 3`, `fail 0`.
- The native helper build completed with `0` warnings and `0` errors.
- The combined focused suites passed: `pass 4`, `fail 0`. The snapshot test
  rendered three valid, distinct 640x400 PNGs at phases `0`, `0.25`, and
  `0.5`.
- `git diff --check` completed without output.

The repository-wide `npm test` was also run. It had one unrelated failure:
Phase 0.15 found an ignored existing Windows release candidate stamped with
commit `4e7c9786bf2376c73520342c54973532ffb9babe`, while the worktree HEAD at
the time was `354d4ffae51ea841dac5fd16bbe579cc68bed6d2`. Its identity check
correctly rejected that stale generated artifact. No release artifacts were
changed by Task 3.

## Changed Files

- `gateway-overlay/LayeredWindowPresenter.cs`: added native per-pixel-alpha
  presentation with `GetDC`, compatible memory DC, temporary HBITMAP,
  `UpdateLayeredWindow`, and deterministic `finally` cleanup.
- `gateway-overlay/Program.cs`: enables `WS_EX_LAYERED`, renders the shared
  compositor at the shared 3200ms phase, presents each frame on the 33ms
  timer, and removes the color-key/WinForms paint pipeline.
- `test/gateway-run.test.mjs`: freezes the presenter ownership, alpha blend,
  cleanup, renderer handoff, and removal of retired paint behavior.
- `.superpowers/sdd/task-3-report.md`: records Task 3 evidence and review.

## Self-Review

- `LayeredWindowPresenter` uses `AC_SRC_OVER`, full source alpha, and
  `AC_SRC_ALPHA` with `ULW_ALPHA`. It restores the old selected bitmap before
  deleting the new HBITMAP, then deletes the compatible DC and releases the
  screen DC in `finally`, including failure paths.
- The form preserves virtual-screen bounds, click-through, no-activate,
  tool-window, topmost, target tracking, and no-activate target raising.
- The 33ms timer now computes phase through
  `OverlayTheme.PhaseAtElapsedMilliseconds`, calls the Task 2 renderer, and
  presents the returned premultiplied ARGB bitmap. No shared compositor files
  were modified.
- `BackColor`, `TransparencyKey`, `DoubleBuffered`, `OnPaintBackground`,
  `OnPaint`, and `Invalidate` usage were removed from the desktop overlay.

## Commit

`f07a291` - `feat: present overlay with per-pixel alpha`

## Concerns

The focused Task 3 build and tests are green. The full suite is blocked only
by the stale ignored Phase 0.15 release candidate described above; rebuilding
or removing that generated release output is outside the assigned Task 3
surface.

## Review Fix RED Evidence

Command:

```powershell
node --test test/gateway-run.test.mjs
```

Result: `pass 2`, `fail 2`. The new source contracts failed because
`LayeredWindowPresenter` did not validate `Format32bppPArgb`, used the
parameterless `GetHbitmap()` overload, and did not expose the injected native
boundary required to exercise explicit operation failures and ordered cleanup.
This is the expected RED state for the Task 3 review fixes.

## Review Fix GREEN Evidence

Commands:

```powershell
node --test test/gateway-run.test.mjs
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs
git diff --check
```

Results:

- The focused gateway contract suite passed: `pass 4`, `fail 0`.
- The native helper build completed with `0` warnings and `0` errors.
- The combined focused suites passed: `pass 5`, `fail 0`, including three
  valid, distinct snapshot PNGs.
- `git diff --check` completed without output before the commit.

## Review Fix Self-Review

- `Present` now accepts only premultiplied 32-bit ARGB frames and uses the
  transparent `GetHbitmap` overload. The source contracts also pin the
  renderer's transparent canvas and its partial-alpha draw path.
- The internal native seam exposes all fallible GDI operations. Cleanup checks
  restore, DC deletion, bitmap deletion, and screen-DC release in order; it
  cannot delete an HBITMAP while its memory DC remains live, and it preserves
  a presentation exception over cleanup errors.
- Only `UpdateLayeredWindow` captures a Win32 last-error value; other native
  failures use explicit operation exceptions. The color-key parameter is
  declared as `uint`.
- `OverlayForm.Dispose(bool)` disposes both timers while retaining the
  virtual-screen, tool-window, and no-activation behavior.

## Review Fix Commit

`c41e5dd24535849a94292efcce913ce2ea2aa837` - `fix: harden layered window presentation`

## Important Review Fix RED Evidence

Command:

```powershell
dotnet run --project gateway-overlay-tests/GatewayComputerUseOverlay.Tests.csproj
```

Result: exit code `1` with `FAIL: Present must preserve its original
presentation exception.` The first executable behavior test called `Present`
against a fake `ILayeredWindowNative`, made `UpdateLayeredWindow` throw, then
made cleanup `SelectObject` throw. The cleanup exception replaced the original
presentation exception and prevented later cleanup, reproducing the review
finding before the production fix.

The fake-only harness was then expanded before its production seam existed;
its initial build failed with `CS0246` for
`ILayeredWindowBitmapFactory`, confirming the injected HBITMAP factory boundary
was absent before implementation.

## Important Review Fix GREEN Evidence

Commands:

```powershell
dotnet run --project gateway-overlay-tests/GatewayComputerUseOverlay.Tests.csproj --no-restore
node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
git diff --check
```

Results:

- The dependency-free executable harness passed all five behavior groups. It
  directly invokes `Present` with fake native, HBITMAP, and window-handle
  boundaries; it verifies PArgb validation, acquisition and presentation
  failures, all thrown/false cleanup operations, cleanup ordering and
  continuation, HBITMAP safety while the memory DC is live, and preservation
  of the original presentation exception.
- The focused Node suites passed: `pass 5`, `fail 0`. The gateway suite now
  launches the behavior harness instead of inferring cleanup correctness from
  source regexes.
- The overlay project built with `0` warnings and `0` errors.
- `git diff --check` completed without output.

## Important Review Fix Self-Review

- Each cleanup call catches its own thrown exception, records only the first
  cleanup failure, and continues to later safe operations. `DeleteObject` is
  skipped unless `DeleteDC` positively reports that the memory DC is gone.
- A presentation exception always wins over cleanup errors. When presentation
  succeeds, the first cleanup error is rethrown with its original stack.
- Production retains the transparent `GetHbitmap(Color.FromArgb(0, 0, 0, 0))`
  factory and PArgb validation. The harness injects both HBITMAP creation and
  window-handle resolution, so it never creates a real window handle or calls
  real GDI/DC APIs.

## Important Review Fix Concerns

None.

## Final Task 3 Review RED Evidence

Command:

```powershell
node --test test/gateway-run.test.mjs
```

Result: `pass 3`, `fail 1`. The new source contract failed because the
`CreateCompatibleDCNative` import did not declare
`EntryPoint = "CreateCompatibleDC"`; the other GDI imports had the same
managed-name/export mismatch.

Command:

```powershell
dotnet run --project gateway-overlay-tests/GatewayComputerUseOverlay.Tests.csproj
```

Result: exit code `1`. The new deselection regression expected `DeleteObject`
after a successful restore and false `DeleteDC`, but the old cleanup sequence
ended at `ReleaseDC`. This proved the HBITMAP leaked when it had already been
deselected but DC destruction failed.

## Final Task 3 Review GREEN Evidence

Commands:

```powershell
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
dotnet run --project gateway-overlay-tests/GatewayComputerUseOverlay.Tests.csproj
node --test test/gateway-run.test.mjs test/gateway-overlay-snapshot.test.mjs
git diff --check
```

Results:

- The overlay build completed with `0` warnings and `0` errors.
- The standalone behavior harness passed all six groups. Its new case proves a
  successfully deselected HBITMAP is deleted after both a false and a thrown
  `DeleteDC`, while the thrown path preserves the original presentation
  exception and continues cleanup.
- The focused Node suites passed: `pass 5`, `fail 0`. The Node harness now
  runs `dotnet run` without `--no-restore`, so a clean checkout can restore
  the test project rather than depending on ignored `obj` output.
- `git diff --check` completed without output.

## Final Task 3 Review Notes

- The four managed `*Native` GDI declarations now map explicitly to the
  `CreateCompatibleDC`, `SelectObject`, `DeleteObject`, and `DeleteDC`
  exports.
- Cleanup tracks successful bitmap deselection independently from successful
  memory-DC destruction. It skips `DeleteObject` only when both mechanisms
  fail to establish that deletion is safe.
