import { createComputerUsePolicy } from "../computer-use-policy.mjs";
import { codedError, structured } from "./shared.mjs";

export function createPrivacyWindowAdapter(options) {
  const mcp = options.mcp;
  const prefixes = [...(options.fixedTitlePrefixes ?? [])];
  const evaluate = options.policyEvaluator ?? createDefaultEvaluator(options.executable?.fileName);
  let started = false;

  return {
    async discover() {
      return options.executable
        ? { executable: options.executable }
        : { status: "not-installed", reason: "app.executable_missing" };
    },
    async prepare() {
      if (!options.applicationId || prefixes.length === 0) throw codedError("policy.private_application_identity_required");
      return { fixture: { applicationId: options.applicationId } };
    },
    async launch() {
      await mcp.start();
      started = true;
      const windows = structured(await mcp.callTool("list_windows", { on_screen_only: false })).windows ?? [];
      const matched = windows.find((window) => matchesApplication(window, options.executable.fileName, prefixes));
      if (!matched) {
        return { status: "infrastructure-error", reason: "app.privacy_window_not_running" };
      }
      return { app: {
        applicationId: options.applicationId,
        processName: options.executable.fileName,
        matchedPrefix: prefixes.find((prefix) => matched.title?.startsWith(prefix)) ?? prefixes[0],
      } };
    },
    async observe(context, app) {
      const target = { applicationId: app.applicationId, processName: app.processName };
      const capture = evaluate({ operation: "capture", target });
      const action = evaluate({ operation: "action", target });
      if (capture?.allowed !== false || action?.allowed !== false) {
        throw codedError("policy.private_window_not_denied");
      }
      return {
        status: "policy-blocked",
        reason: capture.code ?? "policy.private_content_capture_denied",
        finalState: {
          kind: "policy-event",
          applicationId: app.applicationId,
          titlePrefix: app.matchedPrefix,
          captureCode: capture.code,
          actionCode: action.code,
        },
      };
    },
    async act() { throw codedError("policy.private_window_operation_forbidden"); },
    async verify() { throw codedError("policy.private_window_operation_forbidden"); },
    async cleanup() {
      if (started) await mcp.close();
    },
  };
}

function matchesApplication(window, executableName, prefixes) {
  const processName = window.process_name ?? window.processName ?? window.process ?? "";
  return normalizeProcessName(processName) === normalizeProcessName(executableName)
    && prefixes.some((prefix) => window.title?.startsWith(prefix));
}

function normalizeProcessName(value) {
  return String(value).toLowerCase().replace(/\.exe$/u, "");
}

function createDefaultEvaluator(executableName) {
  const escaped = String(executableName ?? "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const policy = createComputerUsePolicy({
    deniedWindows: [{
      category: "private-communications",
      reason: "application-identity",
      processName: new RegExp(`^${escaped}$`, "iu"),
    }],
  });
  return ({ target }) => policy.evaluateAccessRequest({
    tier: "full",
    window: { processName: target.processName },
  });
}
