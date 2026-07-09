import { assertLabObservationSufficient, normalizeCuaObservation } from "./computer-observation.mjs";

export class ComputerUseHarness {
  constructor(options) {
    this.backend = options.backend;
    this.agentId = options.agentId;
    this.sessionId = options.sessionId;
    this.handle = options.handle;
    this.turnId = options.turnId;
    this.audit = [];
    this.activeController = null;
    this.activeWindow = null;
    this.lastCapture = null;
    this.lock = null;
  }

  async requestAccess({ windowTitle, tier }) {
    this.record("computer.approval.request", { request: { windowTitle, tier } });
    this.activeWindow = await this.backend.findWindow({ title: windowTitle });
    this.activeController = {
      provider: "gateway-managed",
      agentId: this.agentId,
      handle: this.handle,
      turnId: this.turnId,
      tier,
    };
    this.lock = {
      lockId: `lock-${this.sessionId}-${this.handle}`,
      owner: this.activeController,
      windowId: this.activeWindow.windowId,
    };
    this.record("computer.approval.resolved", { resolution: "approved" });
    this.record("computer.lock.acquired", { lockId: this.lock.lockId });

    return { status: "approved", controller: this.activeController, window: this.activeWindow };
  }

  async capture({ mode, app }) {
    this.ensureAccess();
    const raw = await this.backend.capture({ windowId: this.activeWindow.windowId, mode, app });
    const observation = raw.provider ? raw : normalizeCuaObservation(raw, { mode });
    assertLabObservationSufficient(observation);
    this.lastCapture = observation;
    this.record("computer.capture.created", {
      observationId: observation.observationId,
      mode: observation.mode,
    });
    return observation;
  }

  async type({ element, text, captureAfter = false }) {
    this.ensureAccess();
    const target = this.resolveElement(element, ["set_value", "type_text"]);
    this.record("computer.action.started", { action: "type", target: { element } });
    await this.backend.setValue({
      windowId: this.activeWindow.windowId,
      elementToken: target.elementToken,
    }, text);
    this.record("computer.action.completed", { action: "type", target: { element } });
    return captureAfter ? this.capture({ mode: this.lastCapture?.mode ?? "som" }) : { ok: true };
  }

  async click({ element, captureAfter = false }) {
    this.ensureAccess();
    const target = this.resolveElement(element, ["click"]);
    this.record("computer.action.started", { action: "click", target: { element } });
    await this.backend.click({
      windowId: this.activeWindow.windowId,
      elementToken: target.elementToken,
    });
    this.record("computer.action.completed", { action: "click", target: { element } });
    return captureAfter ? this.capture({ mode: this.lastCapture?.mode ?? "som" }) : { ok: true };
  }

  listState() {
    return {
      activeController: this.activeController,
      activeWindow: this.activeWindow,
      lock: this.lock,
      lastCapture: this.lastCapture && {
        observationId: this.lastCapture.observationId,
        mode: this.lastCapture.mode,
        elementCount: this.lastCapture.elements.length,
      },
    };
  }

  cancelOrRevoke() {
    if (this.lock) this.record("computer.lock.released", { lockId: this.lock.lockId });
    this.activeController = null;
    this.activeWindow = null;
    this.lastCapture = null;
    this.lock = null;
    return { status: "idle" };
  }

  resolveElement(elementToken, allowedActions) {
    if (!this.lastCapture) throw new Error("capture.required");
    const element = this.lastCapture.elements.find((item) => item.elementToken === elementToken);
    if (!element) throw new Error(`element.not_found: ${elementToken}`);
    const hasAction = allowedActions.some((action) => element.actions.includes(action));
    if (!hasAction) throw new Error(`element.action_unavailable: ${elementToken}`);
    return element;
  }

  ensureAccess() {
    if (!this.activeController || !this.activeWindow || !this.lock) {
      throw new Error("computer.access_required");
    }
  }

  record(type, fields = {}) {
    this.audit.push({
      type,
      provider: "gateway-managed",
      agentId: this.agentId,
      sessionId: this.sessionId,
      handle: this.handle,
      turnId: this.turnId,
      timestamp: this.audit.length + 1,
      ...fields,
    });
  }
}
