import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const overlayProject = resolve("gateway-overlay/GatewayComputerUseOverlay.csproj");
const overlayExe = resolve("gateway-overlay/bin/Debug/net10.0-windows/GatewayComputerUseOverlay.exe");

export async function startGatewayManagedOverlay(options = {}) {
  if (
    process.env.AGENT_COMPUTER_USE_OVERLAY_DISABLED === "1"
    || process.env.XIAOZHICLAW_CUA_OVERLAY_DISABLED === "1"
  ) {
    return {
      visible: false,
      disabled: true,
      stop() {},
    };
  }

  if (!existsSync(overlayExe)) {
    await run("dotnet", ["build", overlayProject], { windowsHide: true });
  }

  const overlayRuntimeDir = mkdtempSync(join(tmpdir(), "agent-computer-use-overlay-"));
  const targetRectFile = join(overlayRuntimeDir, "target-rect.json");
  writeFileSync(targetRectFile, JSON.stringify(options.targetRect ?? null), "utf8");

  const processHandle = spawn(overlayExe, [], {
    stdio: "ignore",
    windowsHide: false,
    detached: false,
    env: {
      ...process.env,
      AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE: targetRectFile,
      XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE: targetRectFile,
    },
  });

  await new Promise((resolvePromise) => setTimeout(resolvePromise, options.startupDelayMs ?? 450));
  return {
    visible: true,
    targetRectFile,
    processId: processHandle.pid,
    stop() {
      stopGatewayManagedOverlay(processHandle);
    },
  };
}

export function stopGatewayManagedOverlay(processHandle) {
  if (processHandle && !processHandle.killed) {
    processHandle.kill();
  }
}

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
