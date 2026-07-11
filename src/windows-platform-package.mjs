import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createPlatformPackageJson, WINDOWS_X64_TARGET } from "./platform-package-contract.mjs";
import { createPlatformInventory, verifyPlatformInventory } from "./platform-payload-inventory.mjs";
import { assertBrowserKernelBoundaryInRoots } from "./browser-kernel-boundary.mjs";

const REQUIRED_COMPONENTS = Object.freeze([
  "cua-driver/",
  "overlay/",
  "ocr-runtime/",
  "models/pp-ocr-v6/",
]);
const FORBIDDEN_ENTRY = /(^|\/)(?:installer|setup|cache|src|test|tests)(?:\/|$)|\.map$/iu;

export async function buildWindowsPlatformPackage(options = {}) {
  const outputRoot = resolve(required(options.outputRoot, "platform.output_root_missing"));
  const version = required(options.version, "platform.version_invalid");
  const sourceCommit = required(options.sourceCommit, "platform.commit_invalid");
  const materialize = options.materialize ?? defaultWindowsPlatformMaterializer;
  const stageRoot = `${outputRoot}.staging-${randomUUID()}`;
  let backupRoot;
  try {
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(stageRoot, { recursive: true });
    const materialized = await materialize(stageRoot, options) ?? {};
    await writeJson(join(stageRoot, "package.json"), createPlatformPackageJson({ version }));
    await writeFile(
      join(stageRoot, "THIRD_PARTY_LICENSES.txt"),
      formatLicenses(materialized.licenses),
      "utf8",
    );
    await writeJson(join(stageRoot, "SBOM.cdx.json"), createPlatformSbom({ version, sourceCommit }));
    await assertBrowserKernelBoundaryInRoots({ roots: ["gateway-overlay", stageRoot] });

    const inventory = await createPlatformInventory(stageRoot, {
      version,
      sourceCommit,
      target: WINDOWS_X64_TARGET,
    });
    assertAllowedEntries(inventory.files);
    assertRequiredComponents(inventory.files);
    const manifest = { ...inventory, components: componentRoots() };
    await writeJson(join(stageRoot, "platform-manifest.json"), manifest);
    const verification = await verifyPlatformInventory(stageRoot, manifest, {
      version,
      sourceCommit,
      target: WINDOWS_X64_TARGET,
    });

    await mkdir(dirname(outputRoot), { recursive: true });
    if ((await stat(outputRoot).catch(() => null))?.isDirectory()) {
      backupRoot = `${outputRoot}.backup-${randomUUID()}`;
      await rename(outputRoot, backupRoot);
    }
    try {
      await rename(stageRoot, outputRoot);
    } catch (error) {
      if (backupRoot) await rename(backupRoot, outputRoot).catch(() => {});
      throw error;
    }
    if (backupRoot) await rm(backupRoot, { recursive: true, force: true });
    return {
      status: "passed",
      packageRoot: outputRoot,
      manifest,
      inventory: verification,
    };
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

export async function defaultWindowsPlatformMaterializer(stageRoot, options = {}) {
  const [
    { acquireReleaseAssets },
    { loadReleaseAssetLock },
    { buildPpOcrV6SmallPack },
    { expandVerifiedZip },
    { publishGatewayOverlay },
  ] = await Promise.all([
    import("./release-asset-acquirer.mjs"),
    import("./release-asset-lock.mjs"),
    import("./ocr-release-model-pack.mjs"),
    import("./verified-zip.mjs"),
    import("./gateway-overlay-build-host.mjs"),
  ]);
  const lock = await loadReleaseAssetLock(options.assetLockPath ?? "release/windows-x64-assets.lock.json");
  const acquired = await acquireReleaseAssets({
    lock,
    cacheRoot: resolve(options.cacheRoot ?? "artifacts/release-cache"),
    allowNetwork: options.allowNetwork === true,
  });
  const assets = new Map(acquired.map((asset) => [asset.id, asset]));
  const workRoot = `${stageRoot}.materialize-${randomUUID()}`;
  try {
    await mkdir(workRoot, { recursive: true });
    await expandVerifiedZip({
      archivePath: requireAsset(assets, "cua-driver-windows-x64").path,
      destinationPath: join(workRoot, "cua-driver"),
    });
    await cp(join(workRoot, "cua-driver"), join(stageRoot, "cua-driver"), { recursive: true });
    await publishGatewayOverlay({ outputRoot: join(stageRoot, "overlay") });
    await cp(
      resolve("node_modules/onnxruntime-node/bin/napi-v6/win32/x64"),
      join(stageRoot, "ocr-runtime"),
      { recursive: true },
    );
    const det = requireAsset(assets, "ocr-model-pp-ocrv6-small-det");
    const rec = requireAsset(assets, "ocr-model-pp-ocrv6-small-rec");
    const metadata = requireAsset(assets, "ocr-model-pp-ocrv6-small-rec-metadata");
    await buildPpOcrV6SmallPack({
      detPath: det.path,
      recPath: rec.path,
      metadataPath: metadata.path,
      outputRoot: join(stageRoot, "models", "pp-ocr-v6"),
      expected: {
        det: { sizeBytes: det.sizeBytes, sha256: det.sha256 },
        rec: { sizeBytes: rec.sizeBytes, sha256: rec.sha256 },
        metadata: { sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 },
      },
    });
    return {
      licenses: lock.assets.map((asset) => `${asset.id}\t${asset.license.spdx}\t${asset.license.sourceUrl}`),
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

function assertRequiredComponents(files) {
  for (const prefix of REQUIRED_COMPONENTS) {
    if (!files.some(({ path }) => path.startsWith(prefix))) {
      throw platformError("platform.component_missing", prefix.slice(0, -1));
    }
  }
}

function assertAllowedEntries(files) {
  const forbidden = files.find(({ path }) => FORBIDDEN_ENTRY.test(path) || !isAllowedPlatformPath(path));
  if (forbidden) throw platformError("platform.entry_forbidden", forbidden.path);
}

function isAllowedPlatformPath(path) {
  if (["package.json", "THIRD_PARTY_LICENSES.txt", "SBOM.cdx.json"].includes(path)) return true;
  const name = path.split("/").at(-1);
  if (path.startsWith("cua-driver/")) {
    return ["cua-driver.exe", "cua-driver-uia.exe"].includes(name);
  }
  if (path.startsWith("overlay/")) {
    return /^GatewayComputerUseOverlay\.(?:exe|dll|pdb|deps\.json|runtimeconfig\.json)$/u.test(name);
  }
  if (path.startsWith("ocr-runtime/")) {
    return ["DirectML.dll", "dxcompiler.dll", "dxil.dll", "onnxruntime.dll", "onnxruntime_binding.node"].includes(name);
  }
  if (path.startsWith("models/pp-ocr-v6/")) {
    return [
      "PP-OCRv6_det_small.onnx",
      "PP-OCRv6_rec_small.onnx",
      "ppocrv6_dict.txt",
      "det.onnx",
      "rec.onnx",
    ].includes(name);
  }
  return false;
}

function componentRoots() {
  return {
    cuaDriver: "cua-driver",
    overlay: "overlay",
    ocrRuntime: "ocr-runtime",
    ocrModels: "models/pp-ocr-v6",
  };
}

function createPlatformSbom({ version, sourceCommit }) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "@agent-computer-use/win32-x64",
        version,
        properties: [{ name: "source.commit", value: sourceCommit }],
      },
    },
    components: [
      { type: "application", name: "cua-driver", version: "0.7.1" },
      { type: "library", name: "onnxruntime", version: "1.27.0" },
      { type: "machine-learning-model", name: "PP-OCRv6-small", version: "6" },
      { type: "application", name: "GatewayComputerUseOverlay", version },
    ],
  };
}

function formatLicenses(licenses) {
  const lines = Array.isArray(licenses) && licenses.length > 0
    ? licenses
    : ["Platform fixture assets are covered by the project release lock."];
  return `${lines.join("\n")}\n`;
}

function requireAsset(assets, id) {
  const asset = assets.get(id);
  if (!asset) throw platformError("platform.asset_missing", id);
  return asset;
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function required(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw platformError(code, String(value));
  return value;
}

function platformError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

