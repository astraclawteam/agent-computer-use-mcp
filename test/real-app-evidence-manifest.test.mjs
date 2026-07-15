import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRealAppEvidenceManifest } from "../src/real-app-evidence-manifest.mjs";

const IDENTITY = Object.freeze({
  gitCommit: "a".repeat(40),
  corePackage: { name: "agent-computer-use-mcp", version: "0.0.1", sha256: "1".repeat(64) },
  platformPackage: { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "0.0.1", sha256: "2".repeat(64) },
  driver: { id: "cua-driver-windows-x64", version: "0.7.1", sha256: "3".repeat(64) },
  overlay: { id: "gateway-overlay", sha256: "4".repeat(64) },
  ocrRuntime: { id: "onnxruntime-node", version: "1.27.0", sha256: "5".repeat(64) },
  modelPack: { id: "pp-ocr-v6-small", sha256: "6".repeat(64) },
});

test("real app evidence binds the exact commercial candidate identity", () => {
  const manifest = buildRealAppEvidenceManifest({
    packageJson: { name: "agent-computer-use-mcp", version: "0.0.1" },
    candidateIdentity: IDENTITY,
    platform: "win32",
    architecture: "x64",
    filters: { roles: ["installed-core"], appIds: [] },
  });

  assert.equal(manifest.phase, "6.2");
  assert.deepEqual(manifest.candidateIdentity, IDENTITY);
  assert.deepEqual(manifest.package, { name: "agent-computer-use-mcp", version: "0.0.1" });
});

test("real app evidence rejects a package identity mismatch", () => {
  assert.throws(() => buildRealAppEvidenceManifest({
    packageJson: { name: "agent-computer-use-mcp", version: "0.0.2" },
    candidateIdentity: IDENTITY,
    platform: "win32",
    architecture: "x64",
    filters: { roles: [], appIds: [] },
  }), /app.real_smoke_candidate_identity_mismatch/);
});
