import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { COMPUTER_USE_EDGES, shouldShowGatewayComputerUseFrame } from "../public/computer-use-mode.mjs";
import * as waveReference from "../public/wave-overlay.mjs";

const { WAVE_THICKNESS } = waveReference;

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

test("Computer Use closed river follows the native 24-48px breathing envelope", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const wave = await readFile(new URL("../public/wave-overlay.mjs", import.meta.url), "utf8");

  assert.match(css, /--wave-depth-min:\s*24px/);
  assert.match(css, /--wave-depth-max:\s*48px/);
  assert.match(css, /--wave-depth-rest:\s*36px/);
  assert.match(css, /--computer-use-wave-min-alpha:\s*\.24/);
  assert.match(css, /--computer-use-wave-max-alpha:\s*\.50/);
  assert.deepEqual(WAVE_THICKNESS, { min: 24, rest: 36, max: 48 });
  assert.equal(waveReference.WAVE_BREATH_PERIOD_MS, 3200);
  assert.deepEqual(waveReference.WAVE_ALPHA, { min: 0.24, max: 0.50 });
  assert.match(wave, /Math\.cos\(TAU \* phase\)/);
  assert.match(wave, /30 \+ \(42 - 30\) \* breathAt\(time\)/);
  assert.match(wave, /waveAt\(index, time, phase\) \* 6/);
  assert.doesNotMatch(wave, /createLinearGradient/);
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

test("Computer Use river pre-mixes one family fill and draws a clay-deep inner rim", async () => {
  const wave = await readFile(new URL("../public/wave-overlay.mjs", import.meta.url), "utf8");

  assert.deepEqual(waveReference.WAVE_FILL_MIX, { clay: 0.72, deep: 0.16, soft: 0.12 });
  assert.equal(
    waveReference.mixWaveFillRgb("217 119 87", "184 89 59", "247 210 195"),
    "215 125 95",
  );
  assert.equal((wave.match(/ctx\.fill\("evenodd"\)/g) ?? []).length, 1);
  assert.doesNotMatch(wave, /ctx\.fillStyle = [^\n]*fillAlpha \* 0\.(?:16|12)/);
  assert.match(wave, /ctx\.strokeStyle = `rgb\(\$\{theme\.deepRgb\} \/ \$\{fillAlpha \* 0\.62\}\)`/);
  assert.match(wave, /createInnerBoundaryPath\(ctx, width, height, time\)/);
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
