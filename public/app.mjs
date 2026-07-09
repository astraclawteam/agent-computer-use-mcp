import { shouldShowGatewayComputerUseFrame } from "./computer-use-mode.mjs";
import { createWaveOverlay } from "./wave-overlay.mjs";

const frame = document.querySelector("[data-computer-use-frame]");
const riverCanvas = document.querySelector("[data-computer-use-river-canvas]");
const status = document.querySelector("[data-status]");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const waveOverlay = createWaveOverlay(riverCanvas);

let activeController = null;

function setMode(mode) {
  if (mode === "gateway-managed") {
    activeController = { provider: "gateway-managed", agentId: "xiaozhi", tier: "full" };
  } else if (mode === "agent-native") {
    activeController = { provider: "agent-native", agentId: "codex" };
  } else {
    activeController = null;
  }
  render();
}

function render() {
  const showFrame = shouldShowGatewayComputerUseFrame(activeController);
  frame.hidden = !showFrame;
  if (showFrame) {
    waveOverlay.start();
  } else {
    waveOverlay.stop();
  }
  document.documentElement.dataset.computerUse = showFrame ? "gateway-managed" : "idle";
  status.textContent = activeController
    ? `${activeController.provider}${activeController.tier ? ` / ${activeController.tier}` : ""}`
    : "idle";
}

for (const button of modeButtons) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

setMode("gateway-managed");
