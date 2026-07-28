import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCaptureScript } from "../src/real-window-capture.mjs";

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
