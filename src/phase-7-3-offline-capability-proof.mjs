import { createOfflineCapabilityProof } from "./offline-capability-proof.mjs";

const ready = createOfflineCapabilityProof({
  bundle: { status: "ready", manifestId: "bundle-2026-07-10" },
  capabilities: readyCapabilities(),
});
const blockedCapabilities = readyCapabilities();
blockedCapabilities["semantic-capture"].networkRequired = true;
blockedCapabilities["semantic-capture"].source = "remote-browser-service";
blockedCapabilities["model-pack-ocr"].status = "missing";
const blocked = createOfflineCapabilityProof({
  bundle: { status: "ready", manifestId: "bundle-2026-07-10" },
  capabilities: blockedCapabilities,
});
const passed = ready.status === "ready"
  && blocked.status === "blocked"
  && ready.networkRequired === false
  && ready.downloadOnFirstEnable === false
  && ready.startsDesktopControl === false
  && ready.includeUserOverlay === false
  && ready.capabilities.map((item) => item.id).join(",") === "health,overlay,semantic-capture,model-pack-ocr"
  && blocked.repairEntryPoints.map((entry) => entry.id).join(",") === [
    "prepare-offline-semantic-capture",
    "cache-configured-ocr-model-pack",
  ].join(",");

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "7.3",
  benchmark: "offline-capability-proof",
  readyStatus: ready.status,
  blockedStatus: blocked.status,
  capabilityIds: ready.capabilities.map((capability) => capability.id),
  blockerReasons: blocked.blockers.map((blocker) => blocker.reason),
  repairEntryPointIds: blocked.repairEntryPoints.map((entry) => entry.id),
  networkRequired: ready.networkRequired,
  downloadOnFirstEnable: ready.downloadOnFirstEnable,
  startsDesktopControl: ready.startsDesktopControl,
  includeUserOverlay: ready.includeUserOverlay,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

function readyCapabilities() {
  return {
    health: {
      status: "ready",
      source: "computer.health.fast",
      networkRequired: false,
    },
    overlay: {
      status: "ready",
      source: "gateway-overlay-cache",
      networkRequired: false,
      includeUserOverlay: false,
    },
    "semantic-capture": {
      status: "ready",
      source: "uia-som-local",
      networkRequired: false,
    },
    "model-pack-ocr": {
      status: "ready",
      source: "pp-ocrv6-small-local-model-pack",
      modelPackId: "ocr-model-pp-ocrv6-small",
      networkRequired: false,
    },
  };
}
