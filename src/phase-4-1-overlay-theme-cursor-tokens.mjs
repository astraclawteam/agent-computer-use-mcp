import {
  buildCursorLifecyclePlan,
  buildOverlayThemeTokens,
} from "./overlay-theme-cursor-tokens.mjs";

const light = buildOverlayThemeTokens({ appearance: "light" });
const dark = buildOverlayThemeTokens({ appearance: "dark" });
const highContrast = buildOverlayThemeTokens({ highContrast: true });
const start = buildCursorLifecyclePlan({ phase: "start", appearance: "dark", cursorId: "default" });
const stop = buildCursorLifecyclePlan({ phase: "stop", cursorId: "default" });

const passed = light.cssVariables["--computer-use-wave-rgb"] === "217 119 87"
  && dark.cssVariables["--computer-use-wave-rgb"] === "217 119 87"
  && highContrast.cssVariables["--computer-use-wave-rgb"] === "255 255 255"
  && start.calls.length === 2
  && stop.calls.length === 1
  && [light, dark, highContrast, start, stop]
    .every((item) => item.includeUserOverlay === false && item.startsDesktopControl === false);

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "4.1",
  benchmark: "overlay-theme-cursor-tokens",
  lightBrandRgb: light.cssVariables["--computer-use-wave-rgb"],
  darkBrandRgb: dark.cssVariables["--computer-use-wave-rgb"],
  highContrastRgb: highContrast.cssVariables["--computer-use-wave-rgb"],
  cursorLifecycleStartCalls: start.calls.length,
  cursorLifecycleStopCalls: stop.calls.length,
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
