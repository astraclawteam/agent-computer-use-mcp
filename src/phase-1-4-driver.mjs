import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkCuaDriverHealth, resolveCuaDriverCandidate } from "./driver-health.mjs";

export async function resolvePhase14Driver(options = {}) {
  const env = options.env ?? process.env;
  const healthProbe = options.healthProbe ?? checkCuaDriverHealth;
  const configured = resolveCuaDriverCandidate(env);
  if (configured) {
    return requireHealthyDriver({
      driverPath: configured,
      source: "configured",
      env,
      healthProbe,
    });
  }

  const pathHealth = await healthProbe({ env });
  if (pathHealth.status === "healthy") {
    return {
      path: pathHealth.driverPath,
      source: "path",
      version: pathHealth.version,
    };
  }

  const packageRoot = options.packageRoot ?? process.cwd();
  const packageVersion = options.packageVersion;
  if (!packageVersion) {
    throw new Error("phase1.4.driver_package_version_required");
  }
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const binaryName = platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const artifactRoot = join(
    packageRoot,
    "artifacts",
    "mcp-executable",
    packageVersion,
    `${platform}-${arch}`,
    "artifact",
  );
  const driverPath = join(artifactRoot, "driver", binaryName);
  const checksumsPath = join(artifactRoot, "checksums.json");
  const pathExists = options.pathExists ?? existsSync;
  if (!pathExists(driverPath) || !pathExists(checksumsPath)) {
    throw unavailableError(pathHealth);
  }

  const readText = options.readText ?? ((path) => readFile(path, "utf8"));
  const hashFile = options.hashFile ?? sha256File;
  const checksums = JSON.parse(await readText(checksumsPath));
  const expectedHash = checksums[`driver/${binaryName}`];
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/u.test(expectedHash)) {
    throw new Error("phase1.4.driver_artifact_checksum_missing");
  }
  const actualHash = await hashFile(driverPath);
  if (actualHash !== expectedHash) {
    throw new Error("phase1.4.driver_artifact_checksum_mismatch");
  }

  return requireHealthyDriver({
    driverPath,
    source: "verified-dev-artifact",
    env,
    healthProbe,
  });
}

export function createPhase14ServerEnvironment(env, driverPath) {
  const childEnv = Object.fromEntries(
    Object.entries(env).filter((entry) => typeof entry[1] === "string"),
  );
  childEnv.AGENT_COMPUTER_USE_CUA_DRIVER = driverPath;
  return childEnv;
}

async function requireHealthyDriver({ driverPath, source, env, healthProbe }) {
  const health = await healthProbe({
    env: {
      ...env,
      AGENT_COMPUTER_USE_CUA_DRIVER: driverPath,
    },
  });
  if (health.status !== "healthy") {
    throw unavailableError(health);
  }
  return {
    path: health.driverPath ?? driverPath,
    source,
    version: health.version,
  };
}

function unavailableError(health) {
  const reason = health?.reason ?? "not-found";
  const detail = health?.detail ? `: ${health.detail}` : "";
  return new Error(`phase1.4.driver_unavailable.${reason}${detail}`);
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}
