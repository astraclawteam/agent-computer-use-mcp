import { createBridgeBackedDriver } from "./bridge-backed-driver.mjs";
import { probeWindowsDesktopPackage } from "./windows-host-discovery.mjs";

export function createClaudeDesktopDriver(options = {}) {
  const desktopProbe = options.desktopProbe ?? (() => probeWindowsDesktopPackage({
    packageName: "Claude",
    executableName: "Claude.exe",
  }));
  return createBridgeBackedDriver({
    sessionBridge: options.sessionBridge,
    discover: async ({ bridgeStatus }) => {
      const identity = await desktopProbe();
      if (!identity.installed || identity.executableKind !== "desktop-msix"
        || identity.packageName !== "Claude" || identity.executableName.toLowerCase() !== "claude.exe") {
        return unavailable("agent_e2e.claude_desktop_not_found", identity.installed === true);
      }
      if (!bridgeStatus.ready) return unavailable(bridgeStatus.blocker, true, identity);
      return Object.freeze({
        available: true,
        hostId: "claude-desktop",
        hostKind: "desktop-msix",
        packageName: identity.packageName,
        version: identity.version,
        executableName: identity.executableName,
        sessionBridge: bridgeStatus.protocol,
      });
    },
  });
}

function unavailable(blocker, installed, identity = {}) {
  return Object.freeze({
    available: false,
    installed,
    hostId: "claude-desktop",
    blocker,
    ...(identity.version ? { version: identity.version } : {}),
  });
}
