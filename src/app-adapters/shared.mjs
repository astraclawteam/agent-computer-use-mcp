import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function structured(result) {
  return result?.structuredContent ?? result ?? {};
}

export async function createTemporaryWorkspace(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeTemporaryWorkspace(root) {
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export async function startDriverSession(mcp, session) {
  await mcp.start();
  await mcp.callTool("start_session", { session });
}

export async function stopDriverSession(mcp, session) {
  await mcp.callTool("end_session", { session }).catch(() => {});
  await mcp.close();
}

export async function waitForWindow(mcp, predicate, options = {}) {
  const sleep = options.sleep ?? ((duration) => new Promise((resolvePromise) => setTimeout(resolvePromise, duration)));
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);
  while (Date.now() <= deadline) {
    const windows = structured(await mcp.callTool("list_windows", { on_screen_only: false })).windows ?? [];
    const match = windows.find(predicate);
    if (match) return match;
    await sleep(250);
  }
  throw codedError("window.not_found");
}

export async function publishOverlayTargetRect(path, window) {
  if (!path || !window?.bounds) return;
  await writeFile(path, JSON.stringify({
    windowId: window.window_id,
    x: window.bounds.x,
    y: window.bounds.y,
    width: window.bounds.width,
    height: window.bounds.height,
    title: window.title ?? "",
  }), "utf8");
}

export function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function inspectWindowsExecutableIdentity(path) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) throw codedError("app.executable_missing");
  const version = await readWindowsFileVersion(path);
  return {
    path,
    fileName: path.split(/[\\/]/u).at(-1),
    version,
    sizeBytes: fileStat.size,
    sha256: await sha256File(path),
  };
}

function readWindowsFileVersion(path) {
  return new Promise((resolvePromise, reject) => {
    execFile("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "$v=(Get-Item -LiteralPath $env:AGENT_COMPUTER_USE_IDENTITY_PATH).VersionInfo.FileVersion; if ([string]::IsNullOrWhiteSpace($v)) { exit 2 }; [Console]::Out.Write($v)",
    ], {
      windowsHide: true,
      env: { ...process.env, AGENT_COMPUTER_USE_IDENTITY_PATH: path },
      timeout: 10_000,
    }, (error, stdout) => {
      if (error || stdout.trim() === "") reject(codedError("app.executable_version_unavailable"));
      else resolvePromise(stdout.trim());
    });
  });
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}
