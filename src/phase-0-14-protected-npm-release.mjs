import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { packProtectedNpmPackage } from "../scripts/pack-protected-npm-package.mjs";
import { runProtectedNpmSmoke } from "../scripts/protected-npm-smoke.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const artifactsRoot = resolve("artifacts");
await mkdir(artifactsRoot, { recursive: true });
const workRoot = await mkdtemp(join(artifactsRoot, "phase-0-14-"));
let smoke;
let packed;
let runError;
try {
  const packageRoot = join(workRoot, "package");
  smoke = await runProtectedNpmSmoke({ outputRoot: packageRoot });
  packed = await packProtectedNpmPackage({
    packageRoot,
    releaseRoot: join(workRoot, "release"),
  });
} catch (error) {
  runError = error;
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
if (runError) throw runError;
const workspaceCleaned = !existsSync(workRoot);
const rootPublishBlocked = packageJson.private === true
  && packageJson.scripts?.prepublishOnly === "node scripts/block-source-publish.mjs";
const passed = smoke.status === "passed"
  && smoke.integrityVerified === true
  && packed.status === "passed"
  && packed.inventory.status === "passed"
  && packed.sourceEntryCount === 0
  && packed.sourceMapCount === 0
  && packed.obfuscatedRuntimeCount === 3
  && /^[a-f0-9]{64}$/.test(packed.tarballSha256 ?? "")
  && rootPublishBlocked
  && workspaceCleaned;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "0.14",
  benchmark: "protected-npm-release",
  rootPublishBlocked,
  integrityVerified: smoke.integrityVerified,
  mcpSmokePassed: smoke.status === "passed",
  sourceEntryCount: packed.sourceEntryCount,
  sourceMapCount: packed.sourceMapCount,
  obfuscatedRuntimeCount: packed.obfuscatedRuntimeCount,
  workspaceCleaned,
  tarballSha256: packed.tarballSha256,
  packedSize: packed.packedSize,
  unpackedSize: packed.unpackedSize,
  startsDesktopControl: false,
  includeUserOverlay: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;
