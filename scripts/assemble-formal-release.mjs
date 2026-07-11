import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assembleFormalRelease, prepareFormalRelease } from "../src/formal-release-assembly.mjs";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const inputRoot = resolve(process.env.AGENT_COMPUTER_USE_FORMAL_INPUT_ROOT ?? join("artifacts/windows-release", packageJson.version));
const stageRoot = resolve(process.env.AGENT_COMPUTER_USE_FORMAL_STAGE_ROOT ?? "artifacts/formal-release-stage");
const outputRoot = resolve(process.env.AGENT_COMPUTER_USE_FORMAL_OUTPUT_ROOT ?? join("artifacts/formal-release", packageJson.version));
const mode = process.argv[2] ?? "assemble";
const common = { inputRoot, stageRoot, packageName: packageJson.name, version: packageJson.version };

const report = mode === "prepare"
  ? await prepareFormalRelease(common)
  : await assembleFormalRelease({
    ...common,
    outputRoot,
    commit: required("GITHUB_SHA"),
    expectedPublisher: required("AGENT_COMPUTER_USE_WINDOWS_PUBLISHER"),
    authenticodeEvidencePath: resolve(required("AGENT_COMPUTER_USE_AUTHENTICODE_EVIDENCE")),
    assetPrivateKeyPath: resolve(required("AGENT_COMPUTER_USE_ASSET_PRIVATE_KEY")),
    assetPublicKeyPath: resolve(required("AGENT_COMPUTER_USE_ASSET_PUBLIC_KEY")),
    assetKeyId: required("AGENT_COMPUTER_USE_ASSET_KEY_ID"),
    generatedAt: required("AGENT_COMPUTER_USE_RELEASE_GENERATED_AT"),
    expiresAt: required("AGENT_COMPUTER_USE_ASSET_EXPIRES_AT"),
  });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`release.environment_missing: ${name}`);
  return value;
}
