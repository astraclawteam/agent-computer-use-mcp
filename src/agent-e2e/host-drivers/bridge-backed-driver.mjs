const BRIDGE_METHODS = Object.freeze([
  "createSession",
  "configureMcp",
  "submitPrompt",
  "waitForTerminal",
  "collectEvidence",
  "cancel",
  "close",
]);

export function createBridgeBackedDriver({ discover, sessionBridge }) {
  if (typeof discover !== "function") throw bridgeError("agent_e2e.host_discovery_required");
  const bridgeStatus = inspectBridge(sessionBridge);
  const requireBridge = () => {
    if (!bridgeStatus.ready) throw bridgeError(bridgeStatus.blocker);
    return sessionBridge;
  };
  return Object.freeze({
    async discover(context) {
      return discover({ context, bridgeStatus });
    },
    async createSession(context) {
      return requireBridge().createSession(context);
    },
    async configureMcp(session, configuration) {
      return requireBridge().configureMcp(session, configuration);
    },
    async submitPrompt(session, prompt) {
      return requireBridge().submitPrompt(session, prompt);
    },
    async waitForTerminal(session, options) {
      return requireBridge().waitForTerminal(session, options);
    },
    async collectEvidence(session) {
      return requireBridge().collectEvidence(session);
    },
    async cancel(session) {
      return requireBridge().cancel(session);
    },
    async close(session) {
      return requireBridge().close(session);
    },
  });
}

function inspectBridge(bridge) {
  if (!bridge) return Object.freeze({ ready: false, blocker: "agent_e2e.host_session_bridge_unavailable" });
  if (bridge.protocol !== "qualification-host-v1") {
    return Object.freeze({ ready: false, blocker: "agent_e2e.host_session_bridge_protocol_invalid" });
  }
  if (BRIDGE_METHODS.some((method) => typeof bridge[method] !== "function")) {
    return Object.freeze({ ready: false, blocker: "agent_e2e.host_session_bridge_invalid" });
  }
  return Object.freeze({ ready: true, protocol: bridge.protocol });
}

function bridgeError(code) {
  const error = new Error(code);
  error.code = code;
  error.failureClass = "infrastructure-failure";
  return error;
}
