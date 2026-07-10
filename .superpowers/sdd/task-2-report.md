# Task 2 Report: Shared Breathing Compositor

## RED Evidence

Command:

```powershell
node --test test/gateway-overlay-snapshot.test.mjs
```

Result: failed with `ENOENT` while opening `gateway-overlay/OverlayTheme.cs` from
the new source-contract assertions. The focused test reported `pass 0`,
`fail 1`. This is the expected failure because the theme and shared compositor
did not yet exist.

## GREEN Evidence

Commands:

```powershell
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
node --test test/gateway-overlay-snapshot.test.mjs
git diff --check
```

Results:

- Build completed with `0` warnings and `0` errors.
- The focused snapshot test passed: `pass 1`, `fail 0`.
- The test wrote three `640x400` PNGs at phases `0`, `0.25`, and `0.5`, checked
  their PNG signatures and dimensions, and confirmed three distinct SHA-256
  hashes.
- `git diff --check` completed without output.

## Changed Files

- `gateway-overlay/OverlayTheme.cs`: deterministic cosine breath state and
  fixed clay, deep-clay, and soft-clay palette constants.
- `gateway-overlay/OverlayRenderer.cs`: shared 32-bit premultiplied ARGB
  compositor with one even-odd closed river, bounded local harmonics, family
  layers, low-alpha white current highlight, and target-frame rendering.
- `gateway-overlay/Program.cs`: snapshot command creates the output directory,
  renders with `OverlayRenderer`, and saves PNG without initializing a window.
- `test/gateway-overlay-snapshot.test.mjs`: source assertions for palette and
  fill-alpha bounds before deterministic snapshot/hash checks.

## Self-Review

- `OverlayTheme.AtPhase` has no wall-clock access and uses the approved
  normalized-phase, cosine, thickness, and fill-alpha formulas.
- `Render` returns `PixelFormat.Format32bppPArgb`; all created `Bitmap`,
  `Graphics`, `GraphicsPath`, `Brush`, and `Pen` instances are deterministically
  disposed by ownership or `using` scopes.
- The only white drawing is the low-alpha current highlight. The target frame
  uses the shared clay palette and breath state.
- Snapshot execution remains on the argument branch, before
  `ApplicationConfiguration.Initialize()` and `OverlayForm` construction.
- Task 3 can present the same compositor by calling the public shared render
  contract; the old desktop paint path was deliberately not changed here.

## Commit

`c6a139674e8fd91a10522b5271c78bd5f089e4c3` - `feat: add deterministic breathing overlay compositor`

## Concerns

None.

## Review Fix Evidence

### RED Evidence

Command:

```powershell
node --test test/gateway-overlay-snapshot.test.mjs
```

Result: failed at the new `BreathPeriodMilliseconds = 3200` contract because
the existing shared theme had only `AtPhase(double)` and no elapsed-time API.
The focused test reported `pass 0`, `fail 1`. This was the intended RED
failure before changing production code.

### GREEN Evidence

Commands:

```powershell
node --test test/gateway-overlay-snapshot.test.mjs
dotnet build gateway-overlay/GatewayComputerUseOverlay.csproj --nologo
git diff --check
```

Results:

- The focused snapshot test passed with `pass 1`, `fail 0`.
- The build completed with `0` warnings and `0` errors.
- `git diff --check` completed without output.
- The snapshot contract now freezes the 3.2-second period, elapsed-time
  modulo mapping, cosine formula, thickness and alpha bounds, premultiplied
  bitmap format, target-frame guard/presence, PNG save path, and snapshot's
  early branch before WinForms initialization.
- The snapshot run produced valid `640x400` PNGs at phases `0`, `0.25`, and
  `0.5` with three distinct SHA-256 hashes.

### Changed Files

- `gateway-overlay/OverlayTheme.cs`: added the shared
  `BreathPeriodMilliseconds = 3200` constant and finite,
  modulo-normalized `PhaseAtElapsedMilliseconds` API for Task 3.
- `test/gateway-overlay-snapshot.test.mjs`: added source contracts for the
  shared timing formula and bounds, renderer format and target behavior, and
  the no-window snapshot branch.
- `.superpowers/sdd/task-2-report.md`: appended this review-fix evidence.

### Self-Review

- `PhaseAtElapsedMilliseconds` maps elapsed `0`, one full period, and negative
  elapsed values deterministically to the normalized phase range, and rejects
  non-finite input.
- `AtPhase` remains wall-clock-free and retains the approved cosine formula
  with exact base-thickness and fill-alpha bounds.
- Existing renderer ownership/disposal, `Format32bppPArgb`, target-frame
  rendering, PNG output, and snapshot-before-window control remain intact;
  the new Node assertions now protect those contracts.
- No files outside the assigned Task 2 surface and report were changed.

### Fix Commit

`98037fa` - `fix: close Task 2 overlay review findings`
