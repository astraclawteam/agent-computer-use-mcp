import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCaptureRequestScript,
  buildCaptureScript,
} from "../src/real-window-capture.mjs";

test("capture_window treats the exact wildcard alias as the foreground window", () => {
  const script = buildCaptureScript("*", "C:\\temp\\foreground.png");

  assert.match(script, /GetForegroundWindow\(\)/);
  assert.match(
    script,
    /String\.Equals\(titlePart == null \? "" : titlePart\.Trim\(\), "\*", StringComparison\.Ordinal\)/,
  );
  assert.match(script, /found = GetForegroundWindow\(\)/);
});

test("capture_window keeps non-wildcard title matching literal", () => {
  const script = buildCaptureScript("ChatGPT", "C:\\temp\\chatgpt.png");

  assert.match(script, /EnumWindows\(delegate/);
  assert.match(script, /title\.IndexOf\(titlePart, StringComparison\.OrdinalIgnoreCase\)/);
});

test("exact HWND capture verifies process identity and forbids screen-copy fallback", () => {
  const script = buildCaptureRequestScript({
    windowId: "77",
    expectedProcessId: 1234,
    outputPath: "C:\\temp\\owned.png",
    allowScreenFallback: false,
  });

  assert.match(script, /found = new IntPtr\(requestedWindowId\)/);
  assert.match(script, /processId != expectedProcessId/);
  assert.match(script, /if \(!allowScreenFallback\)/);
  assert.match(script, /throw new InvalidOperationException\("print_window_failed"\)/);
});
