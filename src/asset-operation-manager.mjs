import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { redactDiagnosticValue } from "./diagnostics-policy.mjs";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;
const MAX_EVENTS = 100;

export class AssetOperationManager {
  constructor(options = {}) {
    if (typeof options.executor !== "function") throw new TypeError("asset.executor_required");
    this.executor = options.executor;
    this.stateRoot = resolve(options.stateRoot);
    this.clock = options.clock ?? {
      now: () => Date.now(),
      iso: (value = Date.now()) => new Date(value).toISOString(),
    };
    this.states = new Map();
    this.running = new Map();
  }

  async start(options = {}) {
    const operationId = validateOperationId(options.operationId);
    const existing = await this.#load(operationId);
    if (existing) return snapshot(existing);
    if (!Array.isArray(options.actionIds) || options.actionIds.length === 0) {
      throw new Error("asset.operation_actions_required");
    }
    const active = [...this.states.values()].find((state) => state.status === "running")
      ?? [...this.running.keys()].map((id) => this.states.get(id)).find(Boolean);
    if (active) throw new Error(`asset.operation_conflict: ${active.operationId}`);

    const now = this.clock.now();
    const state = {
      schemaVersion: 1,
      operationId,
      status: "running",
      actionIds: [...new Set(options.actionIds)],
      allowNetwork: options.allowNetwork === true,
      startedAt: this.clock.iso(now),
      updatedAt: this.clock.iso(now),
      completedAt: null,
      result: null,
      error: null,
      events: [
        {
          seq: 0,
          state: "queued",
          percent: 0,
          terminal: false,
          ts: this.clock.iso(now),
        },
      ],
      startsDesktopControl: false,
      includeUserOverlay: false,
    };
    this.states.set(operationId, state);
    await this.#persist(state);

    const controller = new AbortController();
    const entry = {
      controller,
      timedOut: false,
      cancelReason: null,
      timer: null,
      promise: null,
    };
    const timeoutMs = Math.max(1, options.timeoutMs ?? 300000);
    entry.timer = setTimeout(() => {
      entry.timedOut = true;
      controller.abort(new Error("asset.operation_timeout"));
    }, timeoutMs);
    this.running.set(operationId, entry);
    setImmediate(() => {
      entry.promise = this.#execute(state, {
        ...options,
        actionIds: state.actionIds,
        allowNetwork: state.allowNetwork,
      }, entry);
    });
    return snapshot(state);
  }

  async status(operationId) {
    const id = validateOperationId(operationId);
    const state = await this.#load(id);
    if (!state) throw new Error(`asset.operation_not_found: ${id}`);
    const entry = this.running.get(id);
    if (TERMINAL_STATES.has(state.status) && entry?.promise) {
      await entry.promise;
    }
    return snapshot(state);
  }

  async cancel(operationId, reason = "cancelled") {
    const id = validateOperationId(operationId);
    const state = await this.#load(id);
    if (!state) throw new Error(`asset.operation_not_found: ${id}`);
    if (TERMINAL_STATES.has(state.status)) return snapshot(state);
    const entry = this.running.get(id);
    if (entry) {
      entry.cancelReason = String(reason || "cancelled").slice(0, 200);
      clearTimeout(entry.timer);
      entry.controller.abort(new Error("asset.operation_cancelled"));
    }
    await this.#finish(state, "cancelled", {
      reason: String(reason || "cancelled").slice(0, 200),
    });
    return snapshot(state);
  }

  async cancelAll(reason = "manager-close") {
    const ids = [...this.running.keys()];
    return Promise.all(ids.map((id) => this.cancel(id, reason)));
  }

  async close(reason = "manager-close") {
    await this.cancelAll(reason);
  }

  async #execute(state, options, entry) {
    try {
      if (entry.controller.signal.aborted) throw entry.controller.signal.reason;
      const result = await this.executor(options, {
        signal: entry.controller.signal,
        onEvent: async (event) => {
          if (TERMINAL_STATES.has(state.status)) return;
          this.#appendEvent(state, {
            ...redactDiagnosticValue(event),
            terminal: false,
          });
          await this.#persist(state);
        },
      });
      if (TERMINAL_STATES.has(state.status)) return;
      if (result?.status === "failed") {
        await this.#finish(state, "failed", {
          error: redactDiagnosticValue(result.error ?? { code: "asset.operation_failed" }),
        });
      } else {
        state.result = redactDiagnosticValue(result ?? {});
        await this.#finish(state, "completed");
      }
    } catch (error) {
      if (TERMINAL_STATES.has(state.status)) return;
      if (entry.timedOut) {
        await this.#finish(state, "timed_out", { reason: "timeout" });
      } else if (entry.controller.signal.aborted) {
        await this.#finish(state, "cancelled", { reason: entry.cancelReason ?? "cancelled" });
      } else {
        await this.#finish(state, "failed", {
          error: {
            code: "asset.operation_failed",
            message: redactDiagnosticValue(error instanceof Error ? error.message : String(error)),
          },
        });
      }
    } finally {
      clearTimeout(entry.timer);
      this.running.delete(state.operationId);
    }
  }

  async #finish(state, status, options = {}) {
    if (TERMINAL_STATES.has(state.status)) return;
    state.status = status;
    state.completedAt = this.clock.iso(this.clock.now());
    if (options.error) state.error = options.error;
    this.#appendEvent(state, {
      state: terminalEventState(status),
      percent: status === "completed" ? 100 : state.events.at(-1)?.percent ?? 0,
      reason: options.reason,
      terminal: true,
    });
    await this.#persist(state);
  }

  #appendEvent(state, event) {
    const previous = state.events.at(-1);
    const next = {
      seq: (previous?.seq ?? -1) + 1,
      ts: this.clock.iso(this.clock.now()),
      ...event,
    };
    if (next.reason === undefined) delete next.reason;
    state.events.push(next);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    state.updatedAt = next.ts;
  }

  async #load(operationId) {
    if (this.states.has(operationId)) return this.states.get(operationId);
    try {
      const state = JSON.parse(await readFile(this.#statePath(operationId), "utf8"));
      this.states.set(operationId, state);
      return state;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async #persist(state) {
    await mkdir(this.stateRoot, { recursive: true });
    const target = this.#statePath(state.operationId);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  #statePath(operationId) {
    return join(this.stateRoot, `${operationId}.json`);
  }
}

function validateOperationId(value) {
  if (typeof value !== "string" || !OPERATION_ID_PATTERN.test(value)) {
    throw new Error("asset.operation_id_invalid");
  }
  return value;
}

function terminalEventState(status) {
  if (status === "completed") return "complete";
  return status;
}

function snapshot(value) {
  return structuredClone(value);
}
