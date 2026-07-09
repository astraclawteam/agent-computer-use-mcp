export const BRAND_COLOR = Object.freeze({
  clay: "#D97757",
  claySoft: "#F7D2C3",
  claySoftDark: "#FFE2D6",
  clayRgb: "217 119 87",
});

export const DEFAULT_AGENT_CURSOR_STYLE = Object.freeze({
  cursor_id: "default",
  gradient_colors: [BRAND_COLOR.clay, BRAND_COLOR.claySoft],
  bloom_color: BRAND_COLOR.clay,
});

const THEME_PROFILES = Object.freeze({
  light: {
    appearance: "light",
    waveRgb: BRAND_COLOR.clayRgb,
    fillAlpha: ".38",
    midAlpha: ".18",
    currentPrimaryAlpha: ".34",
    currentSecondaryAlpha: ".22",
    targetFrameAlpha: ".78",
    cursorStyle: DEFAULT_AGENT_CURSOR_STYLE,
  },
  dark: {
    appearance: "dark",
    waveRgb: BRAND_COLOR.clayRgb,
    fillAlpha: ".46",
    midAlpha: ".24",
    currentPrimaryAlpha: ".42",
    currentSecondaryAlpha: ".28",
    targetFrameAlpha: ".86",
    cursorStyle: {
      cursor_id: "default",
      gradient_colors: [BRAND_COLOR.clay, BRAND_COLOR.claySoftDark],
      bloom_color: BRAND_COLOR.clay,
    },
  },
  "high-contrast": {
    appearance: "high-contrast",
    waveRgb: "255 255 255",
    fillAlpha: ".72",
    midAlpha: ".34",
    currentPrimaryAlpha: ".68",
    currentSecondaryAlpha: ".42",
    targetFrameAlpha: "1",
    cursorStyle: {
      cursor_id: "default",
      gradient_colors: ["#FFFFFF", BRAND_COLOR.clay],
      bloom_color: "#FFFFFF",
    },
  },
});

export function buildOverlayThemeTokens(options = {}) {
  const profile = resolveProfile(options);
  const reducedMotion = options.reducedMotion === true;
  return {
    appearance: profile.appearance,
    cssVariables: {
      "--clay-rgb": BRAND_COLOR.clayRgb,
      "--computer-use-wave-rgb": profile.waveRgb,
      "--computer-use-wave-fill-alpha": profile.fillAlpha,
      "--computer-use-wave-mid-alpha": profile.midAlpha,
      "--computer-use-wave-current-primary-alpha": profile.currentPrimaryAlpha,
      "--computer-use-wave-current-secondary-alpha": profile.currentSecondaryAlpha,
      "--computer-use-target-frame-alpha": profile.targetFrameAlpha,
      "--computer-use-motion": reducedMotion ? "reduced" : "normal",
    },
    cursorStyle: {
      ...profile.cursorStyle,
      gradient_colors: [...profile.cursorStyle.gradient_colors],
    },
    accessibility: {
      highContrast: profile.appearance === "high-contrast",
      reducedMotion,
    },
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

export function buildCursorLifecyclePlan(options = {}) {
  const cursorId = options.cursorId ?? "default";
  if (options.phase === "stop") {
    return {
      phase: "stop",
      cursorId,
      cursorVisible: false,
      calls: [
        { name: "set_agent_cursor_enabled", args: { enabled: false, cursor_id: cursorId } },
      ],
      includeUserOverlay: false,
      startsDesktopControl: false,
    };
  }

  const theme = buildOverlayThemeTokens(options);
  const cursorStyle = {
    ...theme.cursorStyle,
    cursor_id: cursorId,
  };
  return {
    phase: "start",
    cursorId,
    cursorVisible: true,
    calls: [
      { name: "set_agent_cursor_enabled", args: { enabled: true, cursor_id: cursorId } },
      { name: "set_agent_cursor_style", args: cursorStyle },
    ],
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function resolveProfile(options) {
  if (options.highContrast === true) return THEME_PROFILES["high-contrast"];
  const appearance = options.appearance === "dark" ? "dark" : "light";
  return THEME_PROFILES[appearance];
}
