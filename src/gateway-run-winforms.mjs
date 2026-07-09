import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const overlayProject = resolve("gateway-overlay/GatewayComputerUseOverlay.csproj");
const overlayExe = resolve("gateway-overlay/bin/Debug/net10.0-windows/GatewayComputerUseOverlay.exe");

let overlayProcess = null;
const overlayRuntimeDir = mkdtempSync(join(tmpdir(), "agent-computer-use-overlay-"));
const targetRectFile = join(overlayRuntimeDir, "target-rect.json");
writeFileSync(targetRectFile, "null", "utf8");

async function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? "inherit",
      shell: false,
      windowsHide: options.windowsHide ?? true,
      env: { ...process.env, ...options.env },
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function startGatewayOverlay() {
  if (!existsSync(overlayExe)) {
    await run("dotnet", ["build", overlayProject], { windowsHide: true });
  }

  overlayProcess = spawn(overlayExe, [], {
    stdio: "ignore",
    windowsHide: false,
    detached: false,
    env: {
      ...process.env,
      AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE: targetRectFile,
      XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE: targetRectFile,
    },
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 450));
  return overlayProcess;
}

function stopGatewayOverlay() {
  if (overlayProcess && !overlayProcess.killed) {
    overlayProcess.kill();
  }
}

try {
  await startGatewayOverlay();
  // Equivalent to package script: phase:0.6:winforms
  await run(process.execPath, ["src/real-cua-winforms-file-sequence.mjs"], {
    windowsHide: true,
    env: {
      AGENT_COMPUTER_USE_CUA_DRIVER: process.env.AGENT_COMPUTER_USE_CUA_DRIVER
        ?? process.env.XIAOZHICLAW_CUA_DRIVER
        ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`,
      XIAOZHICLAW_CUA_DRIVER: process.env.AGENT_COMPUTER_USE_CUA_DRIVER
        ?? process.env.XIAOZHICLAW_CUA_DRIVER
        ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`,
      AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE: targetRectFile,
      XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE: targetRectFile,
    },
  });
} finally {
  stopGatewayOverlay();
}
