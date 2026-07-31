import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPUTER_USE_CAPABILITY_SCHEMA_VERSION,
  COMPUTER_USE_PROVIDER_PROTOCOL_VERSION,
  createComputerUseCapabilityHandshake,
} from "../src/computer-use-capability-handshake.mjs";

test("capability handshake declares the compact Computer Use contract without adding tools", () => {
  const handshake = createComputerUseCapabilityHandshake({
    moduleVersion: "0.0.6",
    resultSchemaVersion: "5.5",
    driver: { status: "healthy", version: "cua-driver 0.7.1" },
    ocr: { status: "ready", modelPack: "PP-OCRv6-small" },
  });

  assert.equal(handshake.schemaVersion, COMPUTER_USE_CAPABILITY_SCHEMA_VERSION);
  assert.equal(handshake.provider.protocolVersion, COMPUTER_USE_PROVIDER_PROTOCOL_VERSION);
  assert.deepEqual(handshake.provider.driver, {
    id: "cua-driver-mcp",
    version: "cua-driver 0.7.1",
    availability: "ready",
  });
  assert.equal(handshake.supports.observation.focusedElementMetadata, true);
  assert.equal(handshake.supports.observation.truncationMetadata, true);
  assert.equal(handshake.supports.observation.coordinateScaleMetadata, true);
  assert.equal(handshake.supports.observation.singleUseSurfaceReceipts, true);
  assert.equal(handshake.supports.observation.screenshotToNativeTransform, true);
  assert.equal(handshake.supports.action.executionPathMetadata, true);
  assert.equal(handshake.supports.action.fallbackReasonMetadata, true);
  assert.equal(handshake.supports.action.oneActionPerObservation, true);
  assert.equal(handshake.supports.security.managedImageContent, true);
  assert.equal(handshake.supports.security.inputDesktopVerification, true);
  assert.equal(handshake.supports.security.capturedSurfaceIdentityVerification, true);
});

test("fast capability handshake reports deferred providers without claiming runtime health", () => {
  const handshake = createComputerUseCapabilityHandshake({
    moduleVersion: "0.0.6",
    resultSchemaVersion: "5.5",
    fast: true,
  });

  assert.equal(handshake.provider.driver.availability, "deferred");
  assert.equal(handshake.provider.ocr.availability, "deferred");
  assert.equal(handshake.provider.driver.version, null);
  assert.equal(handshake.provider.ocr.version, null);
});
