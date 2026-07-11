import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  validateAuthenticodeEvidence,
  validateFormalReleaseIdentity,
} from "../src/formal-release-policy.mjs";
import { writeProductionAssetTrustBundle } from "../src/asset-manifest-signing.mjs";
import {
  buildFormalArtifactPlan,
  buildProductionAssetManifest,
  sanitizeAuthenticodeEvidence,
} from "../src/formal-release-assembly.mjs";

const identity = {
  tag: "v0.0.1",
  packageName: "agent-computer-use-mcp",
  packageVersion: "0.0.1",
  commit: "a".repeat(40),
  mainCommits: ["a".repeat(40)],
  changelog: "# Changelog\n\n## 0.0.1 - 2026-07-11\n",
};

test("formal release identity requires an exact v-tag on main with changelog evidence", () => {
  assert.deepEqual(validateFormalReleaseIdentity(identity), { status: "passed", violations: [] });

  const cases = [
    [{ ...identity, tag: "0.0.1" }, "release.tag_invalid"],
    [{ ...identity, tag: "v0.0.2" }, "release.version_mismatch"],
    [{ ...identity, mainCommits: [] }, "release.commit_not_on_main"],
    [{ ...identity, changelog: "# Changelog\n" }, "release.changelog_missing"],
    [{ ...identity, commit: "short" }, "release.commit_invalid"],
  ];
  for (const [input, code] of cases) {
    assert.ok(validateFormalReleaseIdentity(input).violations.some((item) => item.code === code), code);
  }
});

test("formal Authenticode evidence accepts only timestamped public-trust expected publishers", () => {
  const evidence = [
    {
      path: "agent-computer-use-mcp-0.0.1-windows-x64-installer.exe",
      status: "Valid",
      publisher: "CN=AstraClaw Team, O=AstraClaw Team, C=CN",
      timestamped: true,
      timestampStatus: "Valid",
      profileType: "PublicTrust",
    },
    {
      path: "GatewayComputerUseOverlay.exe",
      status: "Valid",
      publisher: "CN=AstraClaw Team, O=AstraClaw Team, C=CN",
      timestamped: true,
      timestampStatus: "Valid",
      profileType: "PublicTrust",
    },
  ];
  assert.deepEqual(validateAuthenticodeEvidence({
    evidence,
    expectedPublisher: "CN=AstraClaw Team, O=AstraClaw Team, C=CN",
    requiredPaths: evidence.map((item) => item.path),
  }), { status: "passed", violations: [] });

  const invalid = evidence.map((item) => ({ ...item }));
  invalid[0].path = "installer.candidate.exe";
  invalid[0].profileType = "PrivateTrust";
  invalid[1].timestamped = false;
  invalid[1].publisher = "CN=Unexpected Publisher";
  const report = validateAuthenticodeEvidence({
    evidence: invalid,
    expectedPublisher: "CN=AstraClaw Team, O=AstraClaw Team, C=CN",
    requiredPaths: ["installer.candidate.exe", "GatewayComputerUseOverlay.exe", "missing.exe"],
  });
  for (const code of [
    "release.candidate_signature_forbidden",
    "release.public_trust_required",
    "release.timestamp_required",
    "release.publisher_mismatch",
    "release.signature_missing",
  ]) {
    assert.ok(report.violations.some((item) => item.code === code), code);
  }
});

test("production asset trust signs exact non-development manifest bytes with an external P-256 key", async () => {
  const root = await mkdtemp(join(tmpdir(), "formal-asset-trust-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const manifest = {
      schemaVersion: 2,
      developmentOnly: false,
      signing: { algorithm: "ecdsa-p256-sha256", keyId: "release-2026" },
      assets: [],
    };
    const result = await writeProductionAssetTrustBundle({ root, manifest, privateKeyPem, publicKeyPem });
    const bytes = await readFile(result.manifestPath);
    const envelope = JSON.parse(await readFile(result.signaturePath, "utf8"));
    assert.equal(envelope.keyId, "release-2026");
    assert.equal(verify("sha256", bytes, publicKey, Buffer.from(envelope.signature, "base64")), true);
    const keyring = JSON.parse(await readFile(result.keyringPath, "utf8"));
    assert.equal(keyring.keys[0].publicKeyPem, publicKeyPem);

    await assert.rejects(
      () => writeProductionAssetTrustBundle({
        root,
        manifest: { ...manifest, developmentOnly: true },
        privateKeyPem,
        publicKeyPem,
      }),
      /asset\.production_manifest_required/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("formal assembly removes candidate identity and emits deterministic public artifact names", () => {
  const manifest = buildProductionAssetManifest({
    candidate: {
      schemaVersion: 2,
      packageName: "agent-computer-use-mcp",
      packageVersion: "0.0.1",
      releaseId: "candidate-assets-0.0.1-windows-x64",
      developmentOnly: true,
      generatedAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      signing: { algorithm: "ecdsa-p256-sha256", keyId: "candidate-release-assets" },
      assets: [],
    },
    keyId: "release-2026",
    generatedAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2027-07-11T00:00:00.000Z",
  });
  assert.equal(manifest.developmentOnly, false);
  assert.equal(manifest.releaseId, "0.0.1-windows-x64");
  assert.equal(manifest.signing.keyId, "release-2026");
  assert.doesNotMatch(JSON.stringify(manifest), /candidate-release-assets|candidate-assets/);

  const plan = buildFormalArtifactPlan({ packageName: "agent-computer-use-mcp", version: "0.0.1" });
  assert.deepEqual(plan.map((item) => item.fileName), [
    "agent-computer-use-mcp-0.0.1.tgz",
    "agent-computer-use-mcp-0.0.1-asset-manifest.json",
    "agent-computer-use-mcp-0.0.1-asset-manifest.sig",
    "agent-computer-use-mcp-0.0.1-checksums.txt",
    "agent-computer-use-mcp-0.0.1-keyring.json",
    "agent-computer-use-mcp-0.0.1-release-manifest.json",
    "agent-computer-use-mcp-0.0.1-sbom.cdx.json",
    "agent-computer-use-mcp-0.0.1-windows-x64-installer.exe",
    "agent-computer-use-mcp-0.0.1-windows-x64-offline.zip",
  ]);
  assert.equal(plan.every((item) => !item.fileName.includes("candidate")), true);
  assert.deepEqual(sanitizeAuthenticodeEvidence([{
    path: "C:/Users/runner/work/project/installer.exe",
    status: "Valid",
    publisher: "CN=AstraClaw Team",
    timestamped: true,
    timestampStatus: "Valid",
    profileType: "PublicTrust",
  }]), [{
    fileName: "installer.exe",
    status: "Valid",
    publisher: "CN=AstraClaw Team",
    timestamped: true,
    timestampStatus: "Valid",
    profileType: "PublicTrust",
  }]);
});
