import { resolve } from "node:path";

import { runAppAdapter } from "./app-adapters/adapter-contract.mjs";
import { createNativeFixtureAdapter } from "./app-adapters/native-fixture.mjs";
import { inspectWindowsExecutableIdentity } from "./app-adapters/shared.mjs";
import { CuaDriverMcpClient } from "./cua-driver-mcp-driver.mjs";

const driverPath = process.env.AGENT_COMPUTER_USE_CUA_DRIVER
  ?? process.env.XIAOZHICLAW_CUA_DRIVER
  ?? `${process.env.LOCALAPPDATA}\\Programs\\Cua\\cua-driver\\bin\\cua-driver.exe`;
const executablePath = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const mcp = new CuaDriverMcpClient({ driverPath });
const executable = await inspectWindowsExecutableIdentity(executablePath);

const result = await runAppAdapter(createNativeFixtureAdapter({
  mcp,
  executable,
  expectedText: "agent-computer-use-native-winforms",
  session: "agent-computer-use-phase-0-6-winforms",
  overlayTargetRectFile: process.env.AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE
    ?? process.env.XIAOZHICLAW_CUA_OVERLAY_TARGET_RECT_FILE,
}), { controlLease: { id: "phase-0-6-winforms", status: "active" } });

const passed = result.status === "pass";
const report = {
  status: passed ? "passed" : "failed",
  reason: result.reason,
  evidenceKind: "real-app",
  observationProvider: "uia-som",
  usedGuessedCoordinates: false,
  includeUserOverlay: false,
  executable: result.executable,
  finalState: result.finalState,
  cleanup: result.cleanup,
};
(passed ? process.stdout : process.stderr).write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
