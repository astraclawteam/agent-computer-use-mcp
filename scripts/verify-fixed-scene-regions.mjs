#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildRegionOwnedScene } from "../src/scene-region-ownership.mjs";

const configArg = process.argv[2];
const report = await main(configArg).catch((error) => ({
  status: "failed",
  gate: "fixed-scene-region-ownership",
  error: { code: error?.code ?? "scene.verification_failed", message: error?.message ?? String(error) },
}));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;

async function main(path) {
  if (!path) throw sceneProofError("scene.config_path_required", "Pass a fixed-scene JSON path.");
  const configPath = resolve(path);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.schemaVersion !== 1) throw sceneProofError("scene.config_version_invalid", "Expected schemaVersion 1.");
  if (typeof config.imagePath !== "string" || typeof config.imageSha256 !== "string") {
    throw sceneProofError("scene.image_identity_required", "imagePath and imageSha256 are required.");
  }
  const imagePath = resolve(dirname(configPath), config.imagePath);
  const actualImageSha256 = createHash("sha256").update(await readFile(imagePath)).digest("hex");
  if (actualImageSha256 !== config.imageSha256) {
    throw sceneProofError("scene.image_identity_mismatch", "The fixed screenshot does not match its recorded digest.");
  }
  if (config.screenshot?.id !== actualImageSha256) {
    throw sceneProofError("scene.screenshot_id_mismatch", "screenshot.id must be the fixed image SHA-256.");
  }

  const scene = buildRegionOwnedScene(config);
  const expectations = config.expectations ?? {};
  for (const [regionId, expectedHash] of Object.entries(expectations.regionValueSha256 ?? {})) {
    const actualHash = hashText(scene.regionValues[regionId] ?? "");
    if (actualHash !== expectedHash) {
      throw sceneProofError("scene.region_value_mismatch", `Region value mismatch: ${regionId}`);
    }
  }
  for (const claimId of expectations.nonActionableClaimIds ?? []) {
    const element = scene.elements.find((candidate) => candidate.id === claimId);
    if (!element || element.actionable !== false || element.actions.length !== 0) {
      throw sceneProofError("scene.conflict_remained_actionable", `Expected non-actionable claim: ${claimId}`);
    }
  }
  for (const claimId of expectations.actionableClaimIds ?? []) {
    const element = scene.elements.find((candidate) => candidate.id === claimId);
    if (!element || element.actionable !== true) {
      throw sceneProofError("scene.consistent_claim_not_actionable", `Expected actionable claim: ${claimId}`);
    }
  }

  return {
    status: "passed",
    gate: "fixed-scene-region-ownership",
    agentUsed: false,
    llmUsed: false,
    screenshotId: scene.screenshot.id,
    windowId: scene.screenshot.windowId,
    observationVersion: scene.screenshot.observationVersion,
    coordinateSpace: scene.screenshot.coordinateSpace,
    cropOffset: scene.screenshot.cropOffset,
    scale: scene.screenshot.scale,
    regionCount: scene.regions.length,
    elementCount: scene.elements.length,
    conflictCount: scene.elements.filter((element) => element.evidenceConsistency === "conflict").length,
    regionValueSha256: Object.fromEntries(
      Object.entries(scene.regionValues).map(([regionId, value]) => [regionId, hashText(value)]),
    ),
  };
}

function hashText(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function sceneProofError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
