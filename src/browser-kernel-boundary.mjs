import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const BROWSER_KERNEL_PATTERNS = Object.freeze([
  /connectOverCDP/u,
  /createCDPSession/u,
  /CDPBrowserProxy/u,
  /WebContentsView/u,
  /electron\.debugger/u,
  /remote-debugging-port/u,
  /debuggerAddress/u,
  /devtools:\/\//u,
  /(?:from|require\s*\()\s*["'](?:playwright(?:-core)?|puppeteer(?:-core)?|chrome-remote-interface|electron)["']/u,
]);

const BROWSER_KERNEL_DEPENDENCY = /^(?:playwright(?:-core)?|puppeteer(?:-core)?|chrome-remote-interface|chrome-launcher|devtools-protocol|electron|selenium-webdriver)$/u;
const TEXT_RUNTIME_FILE = /\.(?:mjs|cjs|js|ts|tsx|json|html|cs|py|ps1|sh)$/u;

export function assertBrowserKernelBoundary({ dependencies = {}, lockPackages = {}, source = "" } = {}) {
  const names = new Set(Object.keys(dependencies));
  for (const [packagePath, metadata] of Object.entries(lockPackages)) {
    if (packagePath === "" || metadata?.dev === true) continue;
    names.add(metadata?.name ?? packageNameFromLockPath(packagePath));
  }
  for (const dependency of names) {
    if (BROWSER_KERNEL_DEPENDENCY.test(dependency)) {
      throw boundaryError("dependency", dependency);
    }
  }
  for (const pattern of BROWSER_KERNEL_PATTERNS) {
    if (pattern.test(source)) throw boundaryError("token", pattern.source);
  }
  return { status: "passed", dependencyCount: names.size };
}

export async function assertBrowserKernelBoundaryInRoots({ roots, lockPath } = {}) {
  const manifests = [];
  const source = (await Promise.all((roots ?? []).map(async (root) => {
    const absoluteRoot = resolve(root);
    return readRuntimeTree(absoluteRoot, manifests);
  }))).join("\n");
  const dependencies = Object.assign({}, ...manifests.flatMap((manifest) => [
    manifest.dependencies ?? {},
    manifest.optionalDependencies ?? {},
  ]));
  const lockPackages = lockPath
    ? JSON.parse(await readFile(resolve(lockPath), "utf8")).packages ?? {}
    : {};
  return assertBrowserKernelBoundary({ dependencies, lockPackages, source });
}

async function readRuntimeTree(root, manifests) {
  const info = await stat(root);
  if (info.isFile()) return readRuntimeFile(root, manifests);
  const chunks = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) chunks.push(await readRuntimeTree(fullPath, manifests));
    else if (entry.isFile()) chunks.push(await readRuntimeFile(fullPath, manifests));
  }
  return chunks.join("\n");
}

async function readRuntimeFile(file, manifests) {
  if (basename(file) === "browser-kernel-boundary.mjs") return "";
  if (!TEXT_RUNTIME_FILE.test(file)) return "";
  const source = await readFile(file, "utf8");
  if (basename(file) === "package.json") manifests.push(JSON.parse(source));
  return source;
}

function packageNameFromLockPath(packagePath) {
  const marker = "node_modules/";
  const index = packagePath.lastIndexOf(marker);
  return index === -1 ? packagePath : packagePath.slice(index + marker.length);
}

function boundaryError(kind, value) {
  const error = new Error(`release.browser_kernel_${kind}_forbidden: browser kernel ${kind}: ${value}`);
  error.code = `release.browser_kernel_${kind}_forbidden`;
  return error;
}

