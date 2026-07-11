import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { shouldShowGatewayComputerUseFrame } from "../public/computer-use-mode.mjs";
import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { assertBrowserKernelBoundary } from "../src/browser-kernel-boundary.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";
import { buildWindowsPlatformPackage } from "../src/windows-platform-package.mjs";

test("the complete protected npm runtime contains no Preview Browser kernel", async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "agent-computer-use-browser-boundary-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  await buildProtectedNpmPackage({ outputRoot });
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const protectedPackageJson = JSON.parse(await readFile(path.join(outputRoot, "package.json"), "utf8"));
  const protectedRuntime = await readTree(path.join(outputRoot, "dist"));

  assertBrowserKernelBoundary({
    dependencies: {
      ...packageJson.dependencies,
      ...packageJson.optionalDependencies,
      ...protectedPackageJson.dependencies,
      ...protectedPackageJson.optionalDependencies,
    },
    source: protectedRuntime,
  });
});

test("the browser-kernel gate detects direct and transitive dependencies plus raw CDP transports", () => {
  for (const dependency of ["playwright", "puppeteer-core", "chrome-remote-interface", "electron"]) {
    assert.throws(
      () => assertBrowserKernelBoundary({ dependencies: { [dependency]: "1.0.0" }, source: "" }),
      new RegExp(dependency, "u"),
    );
  }
  for (const source of [
    'import { chromium } from "playwright";',
    'const client = require("chrome-remote-interface");',
    'session.createCDPSession();',
    'args.push("--remote-debugging-port=0");',
  ]) {
    assert.throws(() => assertBrowserKernelBoundary({ dependencies: {}, source }), /browser kernel token/u);
  }
  assert.throws(
    () => assertBrowserKernelBoundary({
      dependencies: {},
      source: "",
      lockPackages: {
        "node_modules/safe-parent": { version: "1.0.0" },
        "node_modules/safe-parent/node_modules/playwright-core": { version: "1.0.0" },
      },
    }),
    /playwright-core/u,
  );
});

test("the Windows platform package builder rejects an embedded browser kernel", async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "agent-computer-use-platform-boundary-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  await assert.rejects(
    buildWindowsPlatformPackage({
      outputRoot,
      version: "0.0.1",
      sourceCommit: "a".repeat(40),
      materialize: async (root) => {
        await Promise.all([
          fixture(root, "cua-driver/cua-driver.exe", "driver"),
          fixture(root, "overlay/GatewayComputerUseOverlay.exe", "overlay"),
          fixture(root, "ocr-runtime/onnxruntime.dll", "runtime"),
          fixture(root, "models/pp-ocr-v6/det.onnx", "det"),
          fixture(root, "models/pp-ocr-v6/rec.onnx", "rec"),
          fixture(root, "overlay/fallback.mjs", 'session.createCDPSession();'),
        ]);
      },
    }),
    /browser kernel token/u,
  );
});

test("the public contract names PreviewBrowserService as the sole owner with no fallback kernel", async () => {
  const contract = await readFile("docs/productization/public-mcp-contract-review.md", "utf8");
  const roadmap = await readFile("docs/productization/roadmap.md", "utf8");

  for (const document of [contract, roadmap]) {
    assert.match(document, /`PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment/u);
    assert.match(document, /MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel/u);
  }
});

test("the public MCP exposes no agent-native interception surface", async () => {
  const contract = await readFile("docs/productization/public-mcp-contract-review.md", "utf8");
  const toolNames = COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name);

  assert.equal(shouldShowGatewayComputerUseFrame({ provider: "agent-native", agentId: "codex" }), false);
  assert.equal(toolNames.every((name) => name.startsWith("computer.")), true);
  assert.equal(toolNames.some((name) => /agent|browser|preview/u.test(name)), false);
  assert.match(contract, /agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement/u);
  assert.match(contract, /End-to-end agent-native routing is a host-owned invariant and is not implemented by this MCP package/u);
});

async function fixture(root, relativePath, contents) {
  const file = path.join(root, ...relativePath.split("/"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}

async function readTree(root) {
  const chunks = [];
  for (const name of (await readdir(root)).sort()) {
    const file = path.join(root, name);
    const info = await stat(file);
    if (info.isDirectory()) chunks.push(await readTree(file));
    else if (/\.(?:mjs|cjs|js|ts|tsx|json|html|cs|py)$/u.test(name)) chunks.push(await readFile(file, "utf8"));
  }
  return chunks.join("\n");
}

