import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const overlayProject = resolve("gateway-overlay/GatewayComputerUseOverlay.csproj");
const overlayExe = resolve("gateway-overlay/bin/Debug/net10.0-windows/GatewayComputerUseOverlay.exe");

export function createGatewayOverlaySessionHost(dependencies = {}) {
  const ensureExecutable = dependencies.ensureExecutable ?? defaultEnsureExecutable;
  const createRuntimeDirectory = dependencies.createRuntimeDirectory
    ?? (() => mkdtempSync(join(tmpdir(), "agent-computer-use-overlay-")));
  const spawnOverlay = dependencies.spawnOverlay ?? defaultSpawnOverlay;
  const removeRuntimeDirectory = dependencies.removeRuntimeDirectory
    ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const markerExists = dependencies.markerExists ?? existsSync;

  return {
    async start(options = {}) {
      const environment = options.environment ?? process.env;
      if (
        environment.AGENT_COMPUTER_USE_OVERLAY_DISABLED === "1"
        || environment.XIAOZHICLAW_CUA_OVERLAY_DISABLED === "1"
      ) {
        return {
          visible: false,
          disabled: true,
          stop() {},
        };
      }

      await ensureExecutable(options);
      const overlayRuntimeDir = createRuntimeDirectory();
      const targetRectFile = join(overlayRuntimeDir, "target-rect.json");
      const readinessMarker = join(overlayRuntimeDir, "ready");

      let processHandle;
      try {
        writeFileSync(targetRectFile, JSON.stringify(options.targetRect ?? null), "utf8");
        const childEnvironment = {
          ...environment,
          AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE: targetRectFile,
          XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE: targetRectFile,
          AGENT_COMPUTER_USE_OVERLAY_READY_FILE: readinessMarker,
          XIAOZHICLAW_CUA_OVERLAY_READY_FILE: readinessMarker,
        };
        processHandle = spawnOverlay({ env: childEnvironment, executablePath: options.executablePath });
        await waitForOverlayReadiness(processHandle, readinessMarker, {
          markerExists,
          startupTimeoutMs: options.startupTimeoutMs ?? 5_000,
          readinessPollIntervalMs: options.readinessPollIntervalMs ?? 20,
        });
      } catch (error) {
        await terminateOverlayProcess(processHandle, options.shutdownTimeoutMs ?? 1_000);
        try {
          removeRuntimeDirectory(overlayRuntimeDir);
        } catch {
          // Preserve the readiness failure after making every cleanup attempt.
        }
        throw error;
      }

      let stopped = false;
      return {
        visible: true,
        targetRectFile,
        processId: processHandle.pid,
        stop() {
          if (stopped) return;
          stopped = true;
          stopGatewayManagedOverlay(processHandle);
          removeRuntimeDirectory(overlayRuntimeDir);
        },
      };
    },
  };
}

const defaultHost = createGatewayOverlaySessionHost();

export async function startGatewayManagedOverlay(options = {}) {
  return defaultHost.start(options);
}

export function stopGatewayManagedOverlay(processHandle) {
  if (
    processHandle
    && processHandle.exitCode === null
    && processHandle.signalCode === null
    && !processHandle.killed
  ) {
    processHandle.kill();
  }
}

function waitForOverlayReadiness(processHandle, readinessMarker, options) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let stderr = "";
    let pollTimer;
    let timeoutTimer;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(pollTimer);
      clearTimeout(timeoutTimer);
      processHandle.off("error", onError);
      processHandle.off("exit", onExit);
      processHandle.stderr?.off("data", onStderr);
      callback(value);
    };
    const onStderr = (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    };
    const onError = (error) => {
      finish(reject, new Error(`Overlay failed before readiness: ${error.message}`, { cause: error }));
    };
    const onExit = (code, signal) => {
      const exit = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
      const detail = stderr.trim();
      finish(reject, new Error(`Overlay exited before readiness with ${exit}${detail ? `: ${detail}` : ""}`));
    };
    const poll = () => {
      if (options.markerExists(readinessMarker)) {
        finish(resolvePromise);
        return;
      }
      pollTimer = setTimeout(poll, options.readinessPollIntervalMs);
    };

    processHandle.stderr?.on("data", onStderr);
    processHandle.on("error", onError);
    processHandle.on("exit", onExit);
    timeoutTimer = setTimeout(() => {
      const detail = stderr.trim();
      finish(
        reject,
        new Error(`Overlay did not become ready within ${options.startupTimeoutMs}ms${detail ? `: ${detail}` : ""}`),
      );
    }, options.startupTimeoutMs);
    poll();
  });
}

function terminateOverlayProcess(processHandle, timeoutMs) {
  if (!processHandle || processHandle.exitCode !== null) return Promise.resolve();

  return new Promise((resolvePromise) => {
    let timeout;
    const finish = () => {
      clearTimeout(timeout);
      processHandle.off("exit", finish);
      processHandle.off("error", finish);
      resolvePromise();
    };
    processHandle.once("exit", finish);
    processHandle.once("error", finish);
    timeout = setTimeout(finish, timeoutMs);
    try {
      stopGatewayManagedOverlay(processHandle);
    } catch {
      finish();
    }
  });
}

async function defaultEnsureExecutable(options = {}) {
  if (options.executablePath) {
    if (!existsSync(options.executablePath)) throw new Error("overlay.executable_missing");
    return;
  }
  if (!existsSync(overlayExe)) {
    await run("dotnet", ["build", overlayProject], { windowsHide: true });
  }
}

function defaultSpawnOverlay({ env, executablePath }) {
  return spawn(executablePath ?? overlayExe, [], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: false,
    detached: false,
    env,
  });
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
