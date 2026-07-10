import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("overlay theme tokens preserve brand color and adapt light and dark themes", async () => {
  const {
    buildOverlayThemeTokens,
    DEFAULT_AGENT_CURSOR_STYLE,
  } = await import("../src/overlay-theme-cursor-tokens.mjs");

  const light = buildOverlayThemeTokens({ appearance: "light" });
  assert.equal(light.appearance, "light");
  assert.equal(light.cssVariables["--computer-use-wave-rgb"], "217 119 87");
  assert.equal(light.cssVariables["--computer-use-wave-fill-alpha"], ".38");
  assert.equal(light.cssVariables["--computer-use-target-frame-alpha"], ".78");
  assert.deepEqual(light.cursorStyle, DEFAULT_AGENT_CURSOR_STYLE);
  assert.equal(light.includeUserOverlay, false);
  assert.equal(light.startsDesktopControl, false);

  const dark = buildOverlayThemeTokens({ appearance: "dark" });
  assert.equal(dark.appearance, "dark");
  assert.equal(dark.cssVariables["--computer-use-wave-rgb"], "217 119 87");
  assert.equal(dark.cssVariables["--computer-use-wave-fill-alpha"], ".46");
  assert.equal(dark.cssVariables["--computer-use-target-frame-alpha"], ".86");
  assert.deepEqual(dark.cursorStyle.gradient_colors, ["#D97757", "#FFE2D6"]);
});

test("overlay theme tokens provide a high contrast mode without losing cursor affordance", async () => {
  const { buildOverlayThemeTokens } = await import("../src/overlay-theme-cursor-tokens.mjs");

  const highContrast = buildOverlayThemeTokens({ highContrast: true });

  assert.equal(highContrast.appearance, "high-contrast");
  assert.equal(highContrast.cssVariables["--computer-use-wave-rgb"], "255 255 255");
  assert.equal(highContrast.cssVariables["--computer-use-wave-fill-alpha"], ".72");
  assert.equal(highContrast.cssVariables["--computer-use-target-frame-alpha"], "1");
  assert.deepEqual(highContrast.cursorStyle.gradient_colors, ["#FFFFFF", "#D97757"]);
  assert.equal(highContrast.cursorStyle.bloom_color, "#FFFFFF");
  assert.equal(highContrast.accessibility.highContrast, true);
});

test("cursor lifecycle plan uses shared style tokens and disables cursor on stop", async () => {
  const { buildCursorLifecyclePlan } = await import("../src/overlay-theme-cursor-tokens.mjs");

  const start = buildCursorLifecyclePlan({
    phase: "start",
    cursorId: "default",
    appearance: "dark",
  });
  assert.deepEqual(start.calls.map((call) => call.name), [
    "set_agent_cursor_enabled",
    "set_agent_cursor_style",
  ]);
  assert.deepEqual(start.calls[0].args, { enabled: true, cursor_id: "default" });
  assert.deepEqual(start.calls[1].args.gradient_colors, ["#D97757", "#FFE2D6"]);
  assert.equal(start.includeUserOverlay, false);
  assert.equal(start.startsDesktopControl, false);

  const stop = buildCursorLifecyclePlan({ phase: "stop", cursorId: "default" });
  assert.deepEqual(stop.calls, [
    { name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: "default" } },
  ]);
  assert.equal(stop.cursorVisible, false);
});

test("explicit cua-driver cursor startup uses the shared default cursor style tokens", async () => {
  const { DEFAULT_AGENT_CURSOR_STYLE } = await import("../src/overlay-theme-cursor-tokens.mjs");
  const { CuaDriverMcpDriver } = await import("../src/cua-driver-mcp-driver.mjs");
  const calls = [];
  const driver = new CuaDriverMcpDriver({
    session: "theme-token-test",
    client: {
      async start() {
        calls.push({ method: "start" });
      },
      async callTool(name, args) {
        calls.push({ method: "callTool", name, args });
        if (name === "list_windows") return { windows: [{ window_id: 1, title: "App", pid: 7 }] };
        return { status: "ok" };
      },
      async close() {
        calls.push({ method: "close" });
      },
    },
  });

  await driver.findWindow({ titlePart: "App" });
  assert.equal(calls.some((call) => call.name === "set_agent_cursor_style"), false);
  await driver.startCursor();
  const styleCall = calls.find((call) => call.name === "set_agent_cursor_style");
  assert.deepEqual(styleCall.args, DEFAULT_AGENT_CURSOR_STYLE);
});

test("Phase 4.1 has an executable overlay theme and cursor token smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:4.1"], "node src/phase-4-1-overlay-theme-cursor-tokens.mjs");

  const { ComputerUseProviderRouter } = await import("../src/computer-use-provider-router.mjs");
  const health = await new ComputerUseProviderRouter().health({ fast: true });
  assert.equal(health.phases["4.1"], "overlay-theme-cursor-tokens");

  const result = await runNode(["src/phase-4-1-overlay-theme-cursor-tokens.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "4.1");
  assert.equal(report.benchmark, "overlay-theme-cursor-tokens");
  assert.equal(report.lightBrandRgb, "217 119 87");
  assert.equal(report.darkBrandRgb, "217 119 87");
  assert.equal(report.highContrastRgb, "255 255 255");
  assert.equal(report.cursorLifecycleStartCalls, 2);
  assert.equal(report.cursorLifecycleStopCalls, 1);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.startsDesktopControl, false);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
