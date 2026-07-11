import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { shouldShowGatewayComputerUseFrame } from "../public/computer-use-mode.mjs";
import { buildProtectedNpmPackage } from "../scripts/build-protected-npm-package.mjs";
import { COMPUTER_USE_MCP_TOOLS } from "../src/computer-use-mcp-tools.mjs";

const RELEASE_SOURCE_ROOTS = [
  "src",
  "scripts",
  "public",
  "ocr-sidecar",
  "gateway-overlay",
  "native-lab",
];

const BROWSER_KERNEL_PATTERNS = [
  /connectOverCDP/u,
  /createCDPSession/u,
  /CDPBrowserProxy/u,
  /WebContentsView/u,
  /electron\.debugger/u,
  /remote-debugging-port/u,
  /debuggerAddress/u,
  /devtools:\/\//u,
  /(?:from|require\s*\()\s*["'](?:playwright(?:-core)?|puppeteer(?:-core)?|chrome-remote-interface|electron)["']/u,
];

const BROWSER_KERNEL_DEPENDENCY = /^(?:playwright(?:-core)?|puppeteer(?:-core)?|chrome-remote-interface|chrome-launcher|devtools-protocol|electron|selenium-webdriver)$/u;

test("the complete protected npm runtime contains no Preview Browser kernel", async (t) => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "agent-computer-use-browser-boundary-"));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  await buildProtectedNpmPackage({ outputRoot });
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const protectedPackageJson = JSON.parse(await readFile(path.join(outputRoot, "package.json"), "utf8"));
  const releaseSource = await readRoots(RELEASE_SOURCE_ROOTS);
  const protectedRuntime = await readTree(path.join(outputRoot, "dist"));

  assertBrowserKernelFree({
    dependencies: {
      ...packageJson.dependencies,
      ...packageJson.optionalDependencies,
      ...protectedPackageJson.dependencies,
      ...protectedPackageJson.optionalDependencies,
    },
    source: `${releaseSource}\n${protectedRuntime}`,
  });
});

test("the browser-kernel gate detects alternate dependencies and raw CDP transports", () => {
  for (const dependency of ["playwright", "puppeteer-core", "chrome-remote-interface", "electron"]) {
    assert.throws(
      () => assertBrowserKernelFree({ dependencies: { [dependency]: "1.0.0" }, source: "" }),
      new RegExp(dependency, "u"),
    );
  }
  for (const source of [
    'import { chromium } from "playwright";',
    'const client = require("chrome-remote-interface");',
    'session.createCDPSession();',
    'args.push("--remote-debugging-port=0");',
  ]) {
    assert.throws(() => assertBrowserKernelFree({ dependencies: {}, source }), /browser kernel token/u);
  }
});

test("the public contract names PreviewBrowserService as the sole owner with no fallback kernel", async () => {
  const contract = await readFile("docs/productization/public-mcp-contract-review.md", "utf8");
  const roadmap = await readFile("docs/productization/roadmap.md", "utf8");

  for (const document of [contract, roadmap]) {
    assert.match(document, /`PreviewBrowserService` is the sole owner of the built-in Preview Browser and its CDP attachment/u);
    assert.match(document, /MUST NOT start or attach a fallback CDP, Playwright, or `WebContentsView` kernel/u);
  }
});

test("agent-native capabilities remain outside every Gateway-managed control surface", async () => {
  const contract = await readFile("docs/productization/public-mcp-contract-review.md", "utf8");
  const toolNames = COMPUTER_USE_MCP_TOOLS.map((tool) => tool.name);

  assert.equal(shouldShowGatewayComputerUseFrame({ provider: "agent-native", agentId: "codex" }), false);
  assert.equal(toolNames.every((name) => name.startsWith("computer.")), true);
  assert.equal(toolNames.some((name) => /agent|browser|preview/u.test(name)), false);
  assert.match(contract, /agent-native operations MUST NOT be routed through Gateway approval, target leases, or policy enforcement/u);
});

function assertBrowserKernelFree({ dependencies, source }) {
  for (const dependency of Object.keys(dependencies)) {
    assert.equal(BROWSER_KERNEL_DEPENDENCY.test(dependency), false, `browser kernel dependency: ${dependency}`);
  }
  for (const pattern of BROWSER_KERNEL_PATTERNS) {
    assert.equal(pattern.test(source), false, `browser kernel token: ${pattern.source}`);
  }
}

async function readRoots(roots) {
  return (await Promise.all(roots.map((root) => readTree(path.resolve(root))))).join("\n");
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

