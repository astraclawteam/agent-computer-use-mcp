import { createDaemonLifecycleManager } from "./daemon-lifecycle.mjs";
import {
  createProcessSupervisor,
  getComputerUseChildProcessSpecs,
} from "./process-supervisor.mjs";

export function createDaemonSession(options = {}) {
  const lifecycle = options.lifecycle ?? createDaemonLifecycleManager({
    runtimeRoot: options.runtimeRoot,
    processInfo: options.processInfo,
    isProcessAlive: options.isProcessAlive,
    platform: options.platform,
    env: options.env,
  });
  const supervisor = options.supervisor ?? createProcessSupervisor({
    processFactory: options.processFactory,
  });
  const childSpecs = options.childSpecs ?? getComputerUseChildProcessSpecs(options.childSpecOverrides);
  let lock = null;
  let started = false;

  return {
    async start() {
      const acquire = await lifecycle.acquire({ role: options.role ?? "mcp-daemon" });
      if (acquire.status !== "acquired") {
        lock = acquire;
        return {
          status: acquire.status,
          lock: acquire,
          children: [],
          includeUserOverlay: false,
        };
      }
      lock = {
        ...acquire,
        status: "held",
      };
      started = true;
      const children = Object.entries(childSpecs).map(([name, spec]) => supervisor.ensure(name, spec));
      return {
        status: "started",
        lock: acquire,
        children,
        includeUserOverlay: false,
      };
    },

    health() {
      const childHealth = supervisor.health();
      return {
        status: started && childHealth.status === "healthy" ? "healthy" : childHealth.status,
        lock: lock ?? { status: "not_started" },
        children: childHealth.children,
        recoverActions: childHealth.recoverActions,
        includeUserOverlay: false,
      };
    },

    recover(actionId, args = {}) {
      return supervisor.recover(actionId, args);
    },

    async close(args = {}) {
      const stopped = supervisor.stopAll({ reason: args.reason ?? "session-close" });
      const released = await lifecycle.release();
      started = false;
      lock = null;
      return {
        status: "closed",
        lock: released,
        stoppedChildren: stopped.stoppedChildren,
        children: stopped.children,
        includeUserOverlay: false,
      };
    },
  };
}
