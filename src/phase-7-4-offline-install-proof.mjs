import { createOfflineInstallProof } from "./offline-install-proof.mjs";
import { getInstallLayout } from "./package-foundation.mjs";

const ready = createOfflineInstallProof({
  installLayout: getInstallLayout({ platform: "win32", env: { LOCALAPPDATA: "%LOCALAPPDATA%" } }),
  bundle: { status: "ready", manifestId: "bundle-2026-07-10" },
  capabilities: readyCapabilities(),
});
const blockedCapabilities = readyCapabilities();
blockedCapabilities["semantic-capture"].networkRequired = true;
blockedCapabilities["model-pack-ocr"].status = "missing";
const blocked = createOfflineInstallProof({
  installLayout: {
    ...getInstallLayout({ platform: "win32", env: { LOCALAPPDATA: "%LOCALAPPDATA%" } }),
    cacheRoot: "",
    overlayRoot: "",
  },
  bundle: { status: "needs_setup", manifestId: "bundle-2026-07-10" },
  capabilities: blockedCapabilities,
});

const passed = ready.status === "ready"
  && blocked.status === "blocked"
  && ready.networkRequired === false
  && ready.downloadOnFirstEnable === false
  && ready.startsDesktopControl === false
  && ready.includeUserOverlay === false
  && blocked.repairEntryPoints.map((entry) => entry.id).join(",") === [
    "prepare-cacheRoot",
    "prepare-overlayRoot",
    "prepare-offline-bundle",
    "prepare-offline-semantic-capture",
    "cache-configured-ocr-model-pack",
  ].join(",");

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "7.4",
  benchmark: "offline-install-proof",
  readyStatus: ready.status,
  blockedStatus: blocked.status,
  blockerIds: blocked.blockers.map((blocker) => blocker.id),
  repairEntryPointIds: blocked.repairEntryPoints.map((entry) => entry.id),
  networkRequired: ready.networkRequired,
  downloadOnFirstEnable: ready.downloadOnFirstEnable,
  startsDesktopControl: ready.startsDesktopControl,
  includeUserOverlay: ready.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

function readyCapabilities() {
  return {
    health: { status: "ready", source: "computer.health.fast", networkRequired: false },
    overlay: { status: "ready", source: "gateway-overlay-cache", networkRequired: false, includeUserOverlay: false },
    "semantic-capture": { status: "ready", source: "uia-som-local", networkRequired: false },
    "model-pack-ocr": {
      status: "ready",
      source: "pp-ocrv6-small-local-model-pack",
      modelPackId: "ocr-model-pp-ocrv6-small",
      networkRequired: false,
    },
  };
}
