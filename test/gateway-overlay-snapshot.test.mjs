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
  const renderer = await readFile(resolve("gateway-overlay/OverlayRenderer.cs"), "utf8");
  const program = await readFile(resolve("gateway-overlay/Program.cs"), "utf8");

  assert.match(theme, /Color\.FromArgb\(217, 119, 87\)/);
  assert.match(theme, /Color\.FromArgb\(184, 89, 59\)/);
  assert.match(theme, /Color\.FromArgb\(247, 210, 195\)/);
  assert.match(theme, /MinWaveThickness = 24/);
  assert.match(theme, /MaxWaveThickness = 48/);
  assert.match(theme, /MinFillAlpha = 0\.24/);
  assert.match(theme, /MaxFillAlpha = 0\.50/);
  assert.match(theme, /BreathPeriodMilliseconds = 3200/);
  assert.match(theme, /PhaseAtElapsedMilliseconds\(double elapsedMilliseconds\)/);
  assert.match(theme, /var elapsedInPeriod = elapsedMilliseconds % BreathPeriodMilliseconds;/);
  assert.match(theme, /return elapsedInPeriod \/ BreathPeriodMilliseconds;/);
  assert.match(theme, /var normalized = phase - Math\.Floor\(phase\);/);
  assert.match(theme, /var breath = 0\.5 - 0\.5 \* Math\.Cos\(2 \* Math\.PI \* normalized\);/);
  assert.match(theme, /var baseThickness = 30 \+ \(42 - 30\) \* breath;/);
  assert.match(theme, /var fillAlpha = MinFillAlpha \+ \(MaxFillAlpha - MinFillAlpha\) \* breath;/);
  assert.match(renderer, /new Bitmap\(width, height, PixelFormat\.Format32bppPArgb\)/);
  assert.match(renderer, /public static Bitmap Render\(Size size, double phase, RectangleF\? targetRect\)/);
  assert.match(renderer, /DrawTargetFrame\(graphics, targetRect, state\)/);
  assert.match(renderer, /DrawInnerRim/);
  assert.doesNotMatch(renderer, /LinearGradientBrush/);
  assert.match(renderer, /targetRect is not \{\ } target \|\| target\.Width < 24 \|\| target\.Height < 24/);
  assert.match(program, /SnapshotCompositor\.Render\(snapshot\);[\s\S]*?return 0;/);
  assert.match(program, /Directory\.CreateDirectory\(outputDirectory!\)/);
  assert.match(program, /bitmap\.Save\(options\.OutputPath, ImageFormat\.Png\)/);
  assert.ok(program.indexOf("ApplicationConfiguration.Initialize()") > program.indexOf("SnapshotCompositor.Render(snapshot)"));
  assert.ok(program.indexOf("Application.Run(new OverlayForm())") > program.indexOf("SnapshotCompositor.Render(snapshot)"));

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
