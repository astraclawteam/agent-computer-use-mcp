import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import * as buildHost from "../src/gateway-overlay-build-host.mjs";

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

test("gateway overlay release publish emits exactly one executable", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "gateway-overlay-publish-"));
  try {
    await buildHost.publishGatewayOverlay({ outputRoot: root });
    assert.deepEqual(await readdir(root), ["GatewayComputerUseOverlay.exe"]);
    assert.equal((await stat(join(root, "GatewayComputerUseOverlay.exe"))).size > 1_000_000, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
