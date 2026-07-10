import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { WINDOWS_X64_RELEASE_TARGET, assertReleaseTarget } from "./release-target.mjs";

const REQUIRED_COMPONENTS = [
  "agent-computer-use-mcp",
  "agent-computer-use-installer-windows-x64",
  "node-runtime-windows-x64",
  "cua-driver-windows-x64",
  "gateway-overlay-windows-x64",
  "onnxruntime-node",
  "ocr-model-pp-ocrv6-small-det",
  "ocr-model-pp-ocrv6-small-rec",
];

export async function buildReleaseSbom({
  outputPath,
  lock,
  payloadReport,
  baseSbom,
  generatedAt = new Date().toISOString(),
  projectRoot = resolve("."),
  target: requestedTarget = WINDOWS_X64_RELEASE_TARGET,
} = {}) {
  const target = assertReleaseTarget(requestedTarget);
  const source = baseSbom ?? await createNpmSbom(projectRoot);
  if (source?.bomFormat !== "CycloneDX" || !source?.metadata?.component) {
    throw releaseError("release.sbom_invalid_base", "npm SBOM is not a CycloneDX application document");
  }

  const rootComponent = normalizeComponent(source.metadata.component);
  rootComponent.name = lock?.packageName ?? packageNameFromPurl(rootComponent.purl) ?? rootComponent.name;
  const components = (source.components ?? []).map(normalizeComponent);
  for (const asset of lock?.assets ?? []) {
    components.push(componentFromLockedAsset(asset));
  }

  for (const native of [
    { name: "gateway-overlay-windows-x64", path: "helpers/overlay/GatewayComputerUseOverlay.exe" },
    { name: "agent-computer-use-installer-windows-x64", path: "bin/AgentComputerUse.Installer.exe" },
  ]) {
    const file = (payloadReport?.files ?? []).find((entry) => entry.path?.replaceAll("\\", "/") === native.path);
    if (!file) continue;
    components.push({
      type: "file",
      name: native.name,
      version: file.sha256.slice(0, 12),
      "bom-ref": `native:${native.name}@sha256:${file.sha256}`,
      hashes: [{ alg: "SHA-256", content: file.sha256 }],
      licenses: [{ license: { id: "MIT" } }],
    });
  }

  const unique = deduplicateComponents(components);
  const present = new Set([rootComponent.name, ...unique.map((component) => component.name)]);
  const missing = REQUIRED_COMPONENTS.filter((name) => !present.has(name));
  if (missing.length > 0) {
    const error = releaseError("release.sbom_incomplete", `required release components are absent: ${missing.join(", ")}`);
    error.missingComponents = missing;
    throw error;
  }

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: source.specVersion ?? "1.5",
    serialNumber: source.serialNumber,
    version: source.version ?? 1,
    metadata: {
      timestamp: generatedAt,
      component: rootComponent,
      properties: [
        ...(source.metadata.properties ?? [])
          .filter((property) => property?.name !== "agent-computer-use.releaseTarget"),
        { name: "agent-computer-use.releaseTarget", value: target.id },
      ],
    },
    components: unique.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"], "en")),
  };
  if (Array.isArray(source.dependencies)) sbom.dependencies = structuredClone(source.dependencies);
  if (sbom.serialNumber === undefined) delete sbom.serialNumber;

  const serialized = `${JSON.stringify(sbom, null, 2)}\n`;
  assertPublicSbom(serialized, projectRoot);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  return {
    status: "passed",
    target,
    format: "CycloneDX",
    outputPath: resolve(outputPath),
    componentCount: sbom.components.length + 1,
    startsDesktopControl: false,
    includesUserOverlay: false,
  };
}

function componentFromLockedAsset(asset) {
  return {
    type: "file",
    name: asset.id,
    version: asset.version,
    "bom-ref": `asset:${asset.id}@${asset.version}`,
    hashes: [{ alg: "SHA-256", content: asset.source.sha256 }],
    licenses: [{ license: { id: asset.license.spdx } }],
  };
}

function normalizeComponent(component) {
  const normalized = {
    type: component.type ?? "library",
    name: component.name,
    version: component.version,
    "bom-ref": component["bom-ref"] ?? `component:${component.name}@${component.version ?? "unknown"}`,
  };
  for (const field of ["group", "scope", "purl", "cpe", "hashes", "licenses", "copyright", "externalReferences"]) {
    if (component[field] !== undefined) normalized[field] = structuredClone(component[field]);
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined) delete normalized[key];
  }
  return normalized;
}

function packageNameFromPurl(purl) {
  const prefix = "pkg:npm/";
  if (typeof purl !== "string" || !purl.startsWith(prefix)) return null;
  const versionSeparator = purl.lastIndexOf("@");
  if (versionSeparator <= prefix.length) return null;
  try {
    return decodeURIComponent(purl.slice(prefix.length, versionSeparator));
  } catch {
    return null;
  }
}

function deduplicateComponents(components) {
  const byReference = new Map();
  for (const component of components) {
    const normalized = normalizeComponent(component);
    byReference.set(normalized["bom-ref"], normalized);
  }
  return [...byReference.values()];
}

function assertPublicSbom(serialized, projectRoot) {
  const forbidden = [
    resolve(projectRoot),
    process.env.USERPROFILE,
    process.env.HOME,
    "privateKey",
    "overlayPixels",
    "recognizedText",
  ].filter((value) => typeof value === "string" && value.length > 3);
  const match = forbidden.find((value) => serialized.toLowerCase().includes(value.toLowerCase()));
  if (match) {
    throw releaseError("release.sbom_sensitive_data", "release SBOM contains build-host or runtime-sensitive data");
  }
}

async function createNpmSbom(projectRoot) {
  const npmArguments = [
    "sbom",
    "--omit=dev",
    "--sbom-format=cyclonedx",
    "--sbom-type=application",
  ];
  const command = process.platform === "win32" ? process.execPath : "npm";
  const args = process.platform === "win32"
    ? [process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...npmArguments]
    : npmArguments;
  const output = await capture(command, args, projectRoot);
  try {
    return JSON.parse(output);
  } catch (cause) {
    const error = releaseError("release.sbom_npm_invalid", "npm produced an invalid SBOM document");
    error.cause = cause;
    throw error;
  }
}

function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(releaseError("release.sbom_npm_failed", `npm sbom failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

function releaseError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}
