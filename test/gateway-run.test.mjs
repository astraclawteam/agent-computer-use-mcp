import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { runGatewayOverlayBehaviorHarness } from "../src/gateway-overlay-build-host.mjs";

test("Gateway run script starts desktop overlay before real CUA and always stops it", async () => {
  const script = await readFile(new URL("../src/gateway-run-winforms.mjs", import.meta.url), "utf8");

  assert.match(script, /startGatewayOverlay/);
  assert.match(script, /phase:0\.6:winforms/);
  assert.match(script, /targetRectFile/);
  assert.match(script, /AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE/);
  assert.match(script, /finally[\s\S]*stopGatewayOverlay/);
});

test("WinForms real sequence declares cua-driver session and enables cursor rendering", async () => {
  const script = await readFile(new URL("../src/real-cua-winforms-file-sequence.mjs", import.meta.url), "utf8");

  assert.match(script, /callTool\("start_session"/);
  assert.match(script, /callTool\("set_agent_cursor_enabled"/);
  assert.match(script, /callTool\("set_agent_cursor_style"/);
  assert.match(script, /callTool\("end_session"/);
  assert.match(script, /publishOverlayTargetRect/);
  assert.match(script, /window\.bounds/);
  assert.match(script, /windowId:\s*window\.window_id/);
});

test("Desktop gateway overlay freezes the layered native rendering contract", async () => {
  const program = await readFile(new URL("../gateway-overlay/Program.cs", import.meta.url), "utf8");
  const presenter = await readFile(new URL("../gateway-overlay/LayeredWindowPresenter.cs", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../gateway-overlay/OverlayRenderer.cs", import.meta.url), "utf8");
  const theme = await readFile(new URL("../gateway-overlay/OverlayTheme.cs", import.meta.url), "utf8");
  const displaySelector = await readFile(new URL("../gateway-overlay/OverlayDisplaySelector.cs", import.meta.url), "utf8");
  const project = await readFile(new URL("../gateway-overlay/GatewayComputerUseOverlay.csproj", import.meta.url), "utf8");
  assert.match(program, /TopMost = true/);
  assert.match(program, /WS_EX_TRANSPARENT/);
  assert.match(program, /WS_EX_TOOLWINDOW/);
  assert.match(program, /WS_EX_NOACTIVATE/);
  assert.match(program, /WS_EX_LAYERED/);
  assert.match(program, /Bounds = OverlayDisplaySelector\.SelectDesktopBounds\(allowVirtualDisplays\)/);
  assert.doesNotMatch(program, /SystemInformation\.VirtualScreen/);
  assert.match(program, /ShowWithoutActivation => true/);
  assert.match(program, /OverlayTheme\.PhaseAtElapsedMilliseconds\(_animationClock\.Elapsed\.TotalMilliseconds\)/);
  assert.match(program, /OverlayRenderer\.Render\(ClientSize, phase, _targetRect\)/);
  assert.match(program, /_presenter\.Present\(this, frame, new Point\(Left, Top\)\)/);
  assert.doesNotMatch(program, /TransparencyKey/);
  assert.doesNotMatch(program, /BackColor/);
  assert.doesNotMatch(program, /DoubleBuffered/);
  assert.doesNotMatch(program, /OnPaint/);
  assert.doesNotMatch(program, /Invalidate\(\)/);
  assert.match(program, /Gateway-managed Computer Use/);
  assert.doesNotMatch(project, /Microsoft\.Web\.WebView2/);
  assert.doesNotMatch(program, /WebView2/);
  assert.match(renderer, /PixelFormat\.Format32bppPArgb/);
  assert.match(renderer, /graphics\.Clear\(Color\.Transparent\)/);
  assert.match(renderer, /WithAlpha\(OverlayTheme\.RiverFill, state\.FillAlpha\)/);
  assert.equal((renderer.match(/graphics\.FillPath/g) ?? []).length, 1);
  assert.match(renderer, /Math\.Clamp\(state\.BaseThickness \+ localWave \* 6, 24, 48\)/);
  assert.doesNotMatch(renderer, /LinearGradientBrush/);
  assert.match(renderer, /DrawInnerRim/);
  assert.match(theme, /MinWaveThickness = 24/);
  assert.match(theme, /MaxWaveThickness = 48/);
  assert.match(theme, /MinFillAlpha = 0\.24/);
  assert.match(theme, /MaxFillAlpha = 0\.50/);
  assert.match(theme, /BreathPeriodMilliseconds = 3200/);
  assert.match(displaySelector, /EnumDisplayDevices/);
  assert.match(displaySelector, /DISPLAY_DEVICE_MIRRORING_DRIVER/);
  assert.match(displaySelector, /DISPLAY_DEVICE_REMOTE/);
  assert.match(displaySelector, /DISPLAY_DEVICE_RDPUDD\s*=\s*0x01000000/);
  assert.match(displaySelector, /EnumDisplayDevices\(null, adapterIndex, ref device, 0\)/);
  assert.match(displaySelector, /CharSet\s*=\s*CharSet\.Unicode/);
  assert.match(displaySelector, /MarshalAs\(UnmanagedType\.ByValTStr, SizeConst = 32\)/);
  assert.match(displaySelector, /MarshalAs\(UnmanagedType\.ByValTStr, SizeConst = 128\)/);
  assert.match(program, /AGENT_COMPUTER_USE_OVERLAY_ALLOW_VIRTUAL_DISPLAYS/);
  assert.doesNotMatch(displaySelector, /System\.Management/);
  assert.doesNotMatch(project, /System\.Management/);
  assert.match(presenter, /void Present\(Form window, Bitmap frame, Point screenLocation\)/);
  assert.match(presenter, /frame\.PixelFormat != PixelFormat\.Format32bppPArgb/);
  assert.match(presenter, /frame\.GetHbitmap\(Color\.FromArgb\(0, 0, 0, 0\)\)/);
  assert.doesNotMatch(presenter, /frame\.GetHbitmap\(\)/);
  assert.match(presenter, /GetDC/);
  assert.match(presenter, /CreateCompatibleDC/);
  assert.match(presenter, /SelectObject/);
  assert.match(presenter, /GetHbitmap/);
  assert.match(presenter, /UpdateLayeredWindow/);
  assert.match(presenter, /AC_SRC_OVER/);
  assert.match(presenter, /SourceConstantAlpha = 255/);
  assert.match(presenter, /AlphaFormat = AC_SRC_ALPHA/);
  assert.match(presenter, /finally/);
  assert.match(presenter, /DeleteObject/);
  assert.match(presenter, /DeleteDC/);
  assert.match(presenter, /ReleaseDC/);
  assert.match(presenter, /throw new Win32Exception/);
  assert.match(presenter, /DllImport\("gdi32\.dll", EntryPoint = "CreateCompatibleDC"\)/);
  assert.match(presenter, /DllImport\("gdi32\.dll", EntryPoint = "SelectObject"\)/);
  assert.match(presenter, /DllImport\("gdi32\.dll", EntryPoint = "DeleteObject"\)/);
  assert.match(presenter, /DllImport\("gdi32\.dll", EntryPoint = "DeleteDC"\)/);
  assert.match(program, /AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE/);
  assert.match(program, /SyncTargetRect/);
  assert.match(program, /RaiseTargetWindowNoActivate/);
  assert.match(program, /OverlayTargetGeometry\.ToOverlayRelativeRect\(Bounds, targetBounds\)/);
  assert.match(program, /SWP_NOACTIVATE/);
  assert.match(program, /HWND_NOTOPMOST/);
  assert.match(renderer, /DrawTargetFrame/);
  const firstPresent = program.indexOf("PresentFrame();", program.indexOf("protected override void OnShown"));
  const readinessWrite = program.indexOf("OverlayReadinessMarker.WriteFromEnvironment();");
  assert.ok(firstPresent >= 0 && readinessWrite > firstPresent, "readiness must be written after the first frame presents");
});

test("Layered presenter behavior harness exercises cleanup through Present", async () => {
  const { stdout } = await runGatewayOverlayBehaviorHarness();

  assert.match(stdout, /PASS: preserves presentation exceptions across every thrown cleanup operation/);
  assert.match(stdout, /PASS: deletes a deselected bitmap when memory DC destruction fails/);
  assert.match(stdout, /PASS: reports false cleanup operations after presentation succeeds/);
  assert.match(stdout, /PASS: excludes virtual display adapter families by default/);
  assert.match(stdout, /PASS: prefers the foreground physical display/);
  assert.match(stdout, /PASS: enumerates adapters by index and maps screen device names/);
  assert.match(stdout, /PASS: excludes RDPUDD adapters by state flag/);
  assert.match(stdout, /PASS: maps targets into selected display coordinates/);
  assert.match(stdout, /PASS: renders exact river alpha at breath endpoints/);
  assert.match(stdout, /PASS: renders symmetric luminance on all four edges/);
});
