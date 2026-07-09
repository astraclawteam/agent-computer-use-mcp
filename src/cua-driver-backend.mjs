import { checkCuaDriverHealth } from "./driver-health.mjs";
import { normalizeCuaObservation } from "./computer-observation.mjs";

export class CuaDriverBackend {
  constructor(options = {}) {
    this.driverPath = options.driverPath;
    this.runTool = options.runTool ?? createUnavailableRunTool();
    this.checkHealth = options.checkHealth ?? checkCuaDriverHealth;
  }

  async doctor() {
    if (this.driverPath) {
      return this.checkHealth({
        env: {
          ...process.env,
          AGENT_COMPUTER_USE_CUA_DRIVER: this.driverPath,
          XIAOZHICLAW_CUA_DRIVER: this.driverPath,
        },
      });
    }
    return this.checkHealth();
  }

  async findWindow({ title }) {
    const result = await this.runTool("list_windows", { title });
    const windows = result.windows ?? result;
    const match = Array.isArray(windows)
      ? windows.find((window) => window.title === title || window.name === title)
      : null;

    if (!match) {
      throw new Error(`window.not_found: ${title}`);
    }

    return {
      windowId: match.window_id ?? match.windowId ?? match.id,
      title: match.title ?? match.name,
      pid: match.pid,
    };
  }

  async capture({ windowId, mode = "som" }) {
    const result = await this.runTool("get_window_state", {
      window_id: windowId,
      capture_mode: mode === "som" ? "ax" : mode,
      include_screenshot: false,
    });
    return normalizeCuaObservation(result, { mode });
  }

  async setValue(target, value) {
    return this.runTool("set_value", {
      window_id: target.windowId,
      element_token: target.elementToken,
      value,
    });
  }

  async click(target) {
    return this.runTool("click", {
      window_id: target.windowId,
      element_token: target.elementToken,
      delivery_mode: "background",
    });
  }
}

function createUnavailableRunTool() {
  return async () => {
    throw new Error("cua-driver.tool_runner_unconfigured");
  };
}
