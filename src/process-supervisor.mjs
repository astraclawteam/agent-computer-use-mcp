import { spawn } from "node:child_process";

export function getComputerUseChildProcessSpecs(overrides = {}) {
  return {
    overlay: {
      command: overrides.overlay?.command ?? "gateway-overlay",
      args: overrides.overlay?.args ?? ["--user-only"],
      recoverAction: "restart-overlay",
      includeUserOverlay: false,
    },
    "ocr-sidecar": {
      command: overrides["ocr-sidecar"]?.command ?? process.execPath,
      args: overrides["ocr-sidecar"]?.args ?? ["ocr-sidecar/xiaozhiclaw_ocr_sidecar_native.mjs", "serve"],
      recoverAction: "restart-ocr-sidecar",
      includeUserOverlay: false,
    },
    "cua-driver-mcp": {
      command: overrides["cua-driver-mcp"]?.command ?? "cua-driver",
      args: overrides["cua-driver-mcp"]?.args ?? ["mcp"],
      recoverAction: "restart-cua-driver-mcp",
      includeUserOverlay: false,
    },
  };
}

export function createProcessSupervisor(options = {}) {
  const processFactory = options.processFactory ?? {
    start: (spec) => spawn(spec.command, spec.args ?? [], {
      stdio: spec.stdio ?? "ignore",
      shell: false,
      windowsHide: spec.windowsHide ?? true,
      env: spec.env,
    }),
  };
  const children = new Map();

  return {
    ensure(name, spec) {
      const existing = children.get(name);
      if (existing?.status === "running") return toControlChild(existing);
      const child = startChild({ name, spec, processFactory });
      children.set(name, child);
      return toControlChild(child);
    },

    health() {
      const publicChildren = [...children.values()].map(toStructuredChild);
      const recoverActions = publicChildren
        .filter((child) => child.status !== "running")
        .map((child) => ({
          id: child.recoverAction,
          kind: "process-restart",
          child: child.name,
          reason: child.status,
          executesImmediately: false,
        }));

      return {
        status: recoverActions.length > 0 ? "degraded" : "healthy",
        children: publicChildren,
        recoverActions,
        includeUserOverlay: false,
      };
    },

    recover(actionId, options = {}) {
      const child = [...children.values()].find((candidate) => candidate.spec.recoverAction === actionId);
      if (!child) {
        return {
          status: "not_found",
          actionId,
          executesImmediately: false,
          includeUserOverlay: false,
        };
      }
      if (options.approved !== true) {
        return {
          status: "approval_required",
          actionId,
          child: child.name,
          executesImmediately: false,
          includeUserOverlay: false,
        };
      }

      child.handle?.kill?.();
      const restarted = startChild({
        name: child.name,
        spec: child.spec,
        processFactory,
      });
      children.set(child.name, restarted);
      return {
        status: "restarted",
        actionId,
        child: child.name,
        pid: restarted.pid,
        executesImmediately: true,
        includeUserOverlay: false,
      };
    },

    stopAll(options = {}) {
      const stopped = [];
      for (const child of children.values()) {
        if (child.status !== "stopped") {
          child.handle?.kill?.();
          child.status = "stopped";
        }
        stopped.push(toStructuredChild(child));
      }
      return {
        status: "stopped",
        reason: options.reason ?? "session-close",
        stoppedChildren: stopped.length,
        children: stopped,
        includeUserOverlay: false,
      };
    },
  };
}

function startChild({ name, spec, processFactory }) {
  const handle = processFactory.start(spec);
  const child = {
    name,
    spec,
    handle,
    pid: handle.pid,
    status: "running",
    exitCode: null,
    signal: null,
    error: null,
  };

  handle.on?.("exit", (code, signal) => {
    child.status = "crashed";
    child.exitCode = code;
    child.signal = signal;
  });
  handle.on?.("error", (error) => {
    child.status = "failed";
    child.error = error instanceof Error ? error.message : String(error);
  });

  return child;
}

function toControlChild(child) {
  return {
    ...toStructuredChild(child),
    handle: child.handle,
  };
}

function toStructuredChild(child) {
  return {
    name: child.name,
    status: child.status,
    pid: child.pid,
    command: child.spec.command,
    args: child.spec.args ?? [],
    recoverAction: child.spec.recoverAction,
    exitCode: child.exitCode,
    signal: child.signal,
    error: child.error,
    includeUserOverlay: false,
  };
}
