import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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
  const project = await readFile(new URL("../gateway-overlay/GatewayComputerUseOverlay.csproj", import.meta.url), "utf8");
  assert.match(program, /TopMost = true/);
  assert.match(program, /WS_EX_TRANSPARENT/);
  assert.match(program, /WS_EX_NOACTIVATE/);
  assert.match(program, /WS_EX_LAYERED/);
  assert.match(program, /UpdateLayeredWindow/);
  assert.match(program, /AC_SRC_ALPHA/);
  assert.match(program, /Format32bppPArgb/);
  assert.match(program, /MinWaveThickness = 18/);
  assert.match(program, /MaxWaveThickness = 36/);
  assert.match(program, /BreathPeriodMilliseconds = 3200/);
  assert.doesNotMatch(program, /TransparencyKey/);
  assert.match(program, /Gateway-managed Computer Use/);
  assert.doesNotMatch(project, /Microsoft\.Web\.WebView2/);
  assert.doesNotMatch(program, /WebView2/);
  assert.match(program, /OnPaint/);
  assert.match(program, /GraphicsPath/);
  assert.match(program, /Invalidate\(\)/);
  assert.match(program, /WaveThickness/);
  assert.match(program, /AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE/);
  assert.match(program, /SyncTargetRect/);
  assert.match(program, /RaiseTargetWindowNoActivate/);
  assert.match(program, /SWP_NOACTIVATE/);
  assert.match(program, /HWND_NOTOPMOST/);
  assert.match(program, /DrawTargetFrame/);
});
