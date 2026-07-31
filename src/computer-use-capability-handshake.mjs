export const COMPUTER_USE_CAPABILITY_SCHEMA_VERSION = 1;
export const COMPUTER_USE_PROVIDER_PROTOCOL_VERSION = 2;

export function createComputerUseCapabilityHandshake({
  moduleVersion,
  resultSchemaVersion,
  fast = false,
  driver = null,
  ocr = null,
} = {}) {
  return {
    schemaVersion: COMPUTER_USE_CAPABILITY_SCHEMA_VERSION,
    module: {
      id: "agent-computer-use-mcp",
      version: moduleVersion ?? "unknown",
      resultSchemaVersion: resultSchemaVersion ?? "unknown",
    },
    provider: {
      id: "gateway-managed",
      protocolVersion: COMPUTER_USE_PROVIDER_PROTOCOL_VERSION,
      driver: {
        id: "cua-driver-mcp",
        version: stringOrNull(driver?.version),
        availability: fast ? "deferred" : healthAvailability(driver),
      },
      ocr: {
        id: "pp-ocrv6-onnx",
        version: stringOrNull(ocr?.modelPack ?? ocr?.version),
        availability: fast ? "deferred" : healthAvailability(ocr),
      },
    },
    supports: {
      lifecycle: {
        acquire: true,
        release: true,
        restoreOrLaunchApplication: true,
        leaseBoundControl: true,
        secureDesktopFailClosed: true,
      },
      observation: {
        state: true,
        semantic: true,
        screenshot: true,
        ocrRegion: true,
        changedRegion: true,
        hostVisualUnderstanding: true,
        focusedElementMetadata: true,
        truncationMetadata: true,
        coordinateScaleMetadata: true,
        singleUseSurfaceReceipts: true,
        screenshotToNativeTransform: true,
      },
      action: {
        activateWindow: true,
        setValue: true,
        typeText: true,
        click: true,
        pressKey: true,
        semanticElementTargeting: true,
        observationBoundCoordinates: true,
        focusReceipts: true,
        executionPathMetadata: true,
        fallbackReasonMetadata: true,
        oneActionPerObservation: true,
      },
      delivery: {
        background: true,
        foreground: true,
        unicodeText: true,
      },
      security: {
        gatewayManagedApproval: true,
        overlayExcludedFromObservation: true,
        managedImageContent: true,
        startupNetworkRequired: false,
        selfUpdateAllowed: false,
        inputDesktopVerification: true,
        capturedSurfaceIdentityVerification: true,
      },
    },
  };
}

function healthAvailability(value) {
  if (!value) return "unavailable";
  if (value.status === "healthy" || value.status === "ready") return "ready";
  if (value.status === "degraded") return "degraded";
  return "unavailable";
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
