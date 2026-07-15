import { createBridgeBackedDriver } from "./bridge-backed-driver.mjs";
import { probeWindowsDesktopPackage } from "./windows-host-discovery.mjs";

export function createCodexDesktopDriver(options = {}) {
  const desktopProbe = options.desktopProbe ?? (() => probeWindowsDesktopPackage({
    packageName: "OpenAI.Codex",
    executableName: "Codex.exe",
  }));
  return createBridgeBackedDriver({
    sessionBridge: options.sessionBridge,
    discover: async ({ bridgeStatus }) => {
      const identity = await desktopProbe();
      if (!identity.installed || identity.executableKind !== "desktop-msix") {
        return unavailable("codex", "agent_e2e.codex_desktop_not_found", identity.installed === true);
      }
      if (!bridgeStatus.ready) return unavailable("codex", bridgeStatus.blocker, true, identity);
      return Object.freeze({
        available: true,
        hostId: "codex",
        hostKind: "desktop-msix",
        packageName: identity.packageName,
        version: identity.version,
        executableName: identity.executableName,
        sessionBridge: bridgeStatus.protocol,
      });
    },
  });
}

function unavailable(hostId, blocker, installed, identity = {}) {
  return Object.freeze({
    available: false,
    installed,
    hostId,
    blocker,
    ...(identity.version ? { version: identity.version } : {}),
  });
}
