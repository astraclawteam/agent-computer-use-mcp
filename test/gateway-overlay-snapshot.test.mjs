import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const overlayProject = resolve("gateway-overlay/GatewayComputerUseOverlay.csproj");
const overlayExe = resolve("gateway-overlay/bin/Debug/net10.0-windows/GatewayComputerUseOverlay.exe");

test("native overlay snapshots render valid, dimensioned, distinct PNGs", async () => {
  const theme = await readFile(resolve("gateway-overlay/OverlayTheme.cs"), "utf8");
  assert.match(theme, /Color\.FromArgb\(217, 119, 87\)/);
  assert.match(theme, /Color\.FromArgb\(184, 89, 59\)/);
  assert.match(theme, /Color\.FromArgb\(247, 210, 195\)/);
  assert.match(theme, /MinFillAlpha = 0\.14/);
  assert.match(theme, /MaxFillAlpha = 0\.32/);

  await run("dotnet", ["build", overlayProject, "--nologo"]);
  const outputDirectory = await mkdtemp(join(tmpdir(), "gateway-overlay-snapshot-"));

  try {
    const hashes = [];
    for (const phase of [0, 0.25, 0.5]) {
      const output = join(outputDirectory, `phase-${phase}.png`);
      await run(overlayExe, ["--snapshot", output, "--width", "640", "--height", "400", "--phase", String(phase)]);
      const png = await readFile(output);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.readUInt32BE(16), 640);
      assert.equal(png.readUInt32BE(20), 400);
      assert.ok(png.length > 1_000);
      hashes.push(createHash("sha256").update(png).digest("hex"));
    }
    assert.equal(new Set(hashes).size, 3);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} ${args.join(" ")} timed out`));
    }, 5_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}: ${stderr || stdout}`));
      }
    });
  });
}
