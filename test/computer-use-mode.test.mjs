import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { COMPUTER_USE_EDGES, shouldShowGatewayComputerUseFrame } from "../public/computer-use-mode.mjs";
import { WAVE_THICKNESS } from "../public/wave-overlay.mjs";

test("Gateway frame is visible only for gateway-managed controllers", () => {
  assert.equal(shouldShowGatewayComputerUseFrame(null), false);
  assert.equal(shouldShowGatewayComputerUseFrame({ provider: "agent-native", agentId: "codex" }), false);
  assert.equal(shouldShowGatewayComputerUseFrame({ provider: "gateway-managed", agentId: "xiaozhi" }), true);
});

test("Computer Use demo page includes four edge indicators", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const edge of COMPUTER_USE_EDGES) {
    assert.match(html, new RegExp(`data-computer-use-edge="${edge}"`));
  }
});

test("Computer Use demo page includes a canvas-backed closed river band", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /data-computer-use-river/);
  assert.match(html, /data-computer-use-river-canvas/);
  for (const edge of COMPUTER_USE_EDGES) {
    assert.match(html, new RegExp(`data-computer-use-edge="${edge}"`));
  }
});

test("Computer Use frame CSS is fixed and pointer-transparent", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.computer-use-mode-frame\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.computer-use-mode-frame\s*\{[^}]*pointer-events:\s*none/s);
});

test("Computer Use frame CSS animates ocean wave edges with reduced-motion fallback", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.computer-use-mode-frame__river\s*\{[\s\S]*display:\s*block/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*opacity:\s*\.82/);
});

test("Computer Use closed river varies visible thickness inside the 8-16px range", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /--wave-depth-min:\s*8px/);
  assert.match(css, /--wave-depth-max:\s*16px/);
  assert.match(css, /--wave-depth-rest:\s*12px/);
  assert.deepEqual(WAVE_THICKNESS, { min: 8, rest: 12, max: 16 });
});

test("Computer Use closed river uses shared brand color tokens", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const overlay = await readFile(new URL("../gateway-overlay/overlay.html", import.meta.url), "utf8");
  const wave = await readFile(new URL("../public/wave-overlay.mjs", import.meta.url), "utf8");

  assert.match(css, /--clay-rgb:\s*217 119 87/);
  assert.match(css, /--computer-use-wave-rgb:\s*var\(--clay-rgb\)/);
  assert.match(overlay, /--computer-use-wave-rgb:\s*var\(--clay-rgb\)/);
  assert.match(wave, /--computer-use-wave-rgb/);
  assert.doesNotMatch(wave, /rgba\(217,\s*119,\s*87/);
});

test("Computer Use closed river uses one owner for corners instead of overlapping bands", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.computer-use-mode-frame__river\s*\{[\s\S]*inset:\s*0/);
  assert.match(css, /\.computer-use-mode-frame__corner-marker\s*\{[\s\S]*opacity:\s*0/);
  assert.doesNotMatch(css, /stroke-dasharray/);
  assert.doesNotMatch(css, /computer-use-wave-filter/);
  assert.doesNotMatch(css, /top:\s*var\(--wave-corner-fade\)/);
  assert.doesNotMatch(css, /height:\s*calc\(100vh - var\(--wave-corner-fade\) \* 2\)/);
});
