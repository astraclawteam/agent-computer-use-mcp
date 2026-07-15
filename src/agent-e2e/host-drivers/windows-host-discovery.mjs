import { spawn } from "node:child_process";

export async function probeWindowsDesktopPackage(options = {}) {
  const packageName = requiredString(options.packageName, "agent_e2e.desktop_package_name_required");
  const executableName = requiredString(options.executableName, "agent_e2e.desktop_executable_name_required");
  const runPowerShell = options.runPowerShell ?? defaultPowerShellProbe;
  const raw = await runPowerShell({ packageName, executableName });
  return normalizeWindowsDesktopProbe(raw);
}

export function normalizeWindowsDesktopProbe(raw) {
  if (!raw || raw.installed === false) return Object.freeze({ installed: false });
  const packageName = requiredString(raw.packageName, "agent_e2e.desktop_package_identity_invalid");
  const packageFullName = requiredString(raw.packageFullName, "agent_e2e.desktop_package_identity_invalid");
  const version = requiredString(raw.version, "agent_e2e.desktop_package_identity_invalid");
  const executableName = requiredString(raw.executableName, "agent_e2e.desktop_package_identity_invalid");
  const executablePath = typeof raw.executablePath === "string" ? raw.executablePath : "";
  const executableKind = raw.executableKind === "claude-code"
    || /(?:claude-code|AppData[\\/]Roaming[\\/]npm)/iu.test(executablePath)
    ? "claude-code"
    : "desktop-msix";
  return Object.freeze({ installed: true, packageName, packageFullName, version, executableName, executableKind });
}

function defaultPowerShellProbe({ packageName, executableName }) {
  const script = [
    "$package = Get-AppxPackage -Name $env:AGENT_E2E_PACKAGE_NAME -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $package) { @{ installed = $false } | ConvertTo-Json -Compress; exit 0 }",
    "@{ installed = $true; packageName = $package.Name; packageFullName = $package.PackageFullName; version = $package.Version.ToString(); installLocation = $package.InstallLocation; executableName = $env:AGENT_E2E_EXECUTABLE_NAME } | ConvertTo-Json -Compress",
  ].join("; ");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AGENT_E2E_PACKAGE_NAME: packageName, AGENT_E2E_EXECUTABLE_NAME: executableName },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(discoveryError("agent_e2e.desktop_probe_failed", stderr.trim()));
      try { resolvePromise(JSON.parse(stdout)); }
      catch { reject(discoveryError("agent_e2e.desktop_probe_invalid")); }
    });
  });
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw discoveryError(code);
  return value;
}

function discoveryError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
