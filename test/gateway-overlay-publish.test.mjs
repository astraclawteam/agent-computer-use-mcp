import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import * as buildHost from "../src/gateway-overlay-build-host.mjs";
import { createGatewayOverlaySessionHost } from "../src/gateway-overlay-session.mjs";

test("gateway overlay release publish freezes the self-contained single-file contract", () => {
  assert.equal(typeof buildHost.createGatewayOverlayPublishArgs, "function");
  assert.deepEqual(
    buildHost.createGatewayOverlayPublishArgs("C:/release/overlay"),
    [
      "publish",
      "gateway-overlay/GatewayComputerUseOverlay.csproj",
      "--configuration", "Release",
      "--runtime", "win-x64",
      "--self-contained", "true",
      "--output", "C:/release/overlay",
      "--nologo",
      "-p:PublishSingleFile=true",
      "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-p:EnableCompressionInSingleFile=true",
      "-p:DebugType=None",
    ],
  );
});

test("gateway overlay release publish emits one executable that cold-starts within the product timeout", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "gateway-overlay-publish-"));
  const extractionRoot = await mkdtemp(join(tmpdir(), "gateway-overlay-extract-"));
  let overlay;
  try {
    await buildHost.publishGatewayOverlay({ outputRoot: root });
    assert.deepEqual(await readdir(root), ["GatewayComputerUseOverlay.exe"]);
    const executablePath = join(root, "GatewayComputerUseOverlay.exe");
    assert.equal((await stat(executablePath)).size > 1_000_000, true);

    const startedAt = Date.now();
    overlay = await createGatewayOverlaySessionHost().start({
      executablePath,
      startupTimeoutMs: 5_000,
      environment: {
        ...process.env,
        DOTNET_BUNDLE_EXTRACT_BASE_DIR: extractionRoot,
        AGENT_COMPUTER_USE_OVERLAY_ALLOW_VIRTUAL_DISPLAYS: "1",
      },
    });
    assert.equal(overlay.visible, true);
    assert.equal(Date.now() - startedAt < 5_000, true);
  } finally {
    overlay?.stop();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(extractionRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
