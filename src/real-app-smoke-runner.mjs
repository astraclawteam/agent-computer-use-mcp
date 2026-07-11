import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export async function runRealAppSmokeCatalog(options = {}) {
  const catalog = options.catalog ?? [];
  const resolveExecutable = options.resolveExecutable ?? defaultResolveExecutable;
  const execute = options.execute ?? executeSmoke;
  const overlay = options.startOverlay ? await options.startOverlay() : null;
  const results = [];
  const violations = [];
  try {
    for (const entry of catalog) {
      if (entry.policyBlockedReason) {
        results.push(baseResult(entry, {
          status: "blocked",
          reason: entry.policyBlockedReason,
          executable: null,
          evidenceKind: "machine-policy",
        }));
        continue;
      }
      const executable = await resolveExecutable(entry);
      if (!executable) {
        const result = baseResult(entry, {
          status: "blocked",
          reason: "app.executable_missing",
          executable: null,
          evidenceKind: "machine-probe",
        });
        results.push(result);
        if (entry.required !== false) violations.push({ code: "app.required_smoke_blocked", appId: entry.appId });
        continue;
      }
      const execution = await execute(entry, executable, { targetRectFile: overlay?.targetRectFile });
      const report = execution.report ?? {};
      let status = execution.exitCode === 0 && report.status === "passed" ? "pass" : "insufficient";
      let reason = status === "pass" ? null : report.reason ?? "observation.insufficient";
      if (report.evidenceKind !== "real-app") {
        status = "insufficient";
        reason = "observation.insufficient";
      } else if (report.usedGuessedCoordinates === true) {
        status = "insufficient";
        reason = "observation.guessed_coordinates_forbidden";
      } else if (report.includeUserOverlay !== false) {
        status = "insufficient";
        reason = "observation.overlay_exclusion_required";
      }
      const result = baseResult(entry, {
        status,
        reason,
        executable: sanitizeExecutable(executable),
        evidenceKind: report.evidenceKind ?? "missing",
        observationProvider: report.observationProvider ?? null,
        durationMs: execution.durationMs ?? null,
      });
      results.push(result);
      const expectedInsufficient = entry.expectedStatus === "insufficient"
        && status === "insufficient"
        && reason === "observation.insufficient"
        && report.evidenceKind === "real-app"
        && report.usedGuessedCoordinates !== true
        && report.includeUserOverlay === false;
      if (status !== "pass" && !expectedInsufficient && (entry.required !== false || executable)) {
        violations.push({ code: reason, appId: entry.appId });
      }
    }
  } finally {
    await overlay?.stop?.();
  }
  return {
    schemaVersion: 1,
    status: violations.length === 0 ? "passed" : "failed",
    phase: "6.2",
    benchmark: "real-app-perception-smoke",
    attemptedCount: results.filter((item) => item.executable !== null).length,
    passedCount: results.filter((item) => item.status === "pass").length,
    blockedCount: results.filter((item) => item.status === "blocked").length,
    insufficientCount: results.filter((item) => item.status === "insufficient").length,
    results,
    violations,
    includeUserOverlay: false,
  };
}

async function defaultResolveExecutable(entry) {
  for (const candidate of entry.executableCandidates ?? []) {
    const path = resolve(expandEnvironment(candidate));
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile()) continue;
    return {
      fileName: basename(path),
      path,
      sizeBytes: fileStat.size,
      sha256: createHash("sha256").update(await readFile(path)).digest("hex"),
    };
  }
  return null;
}

function executeSmoke(entry, executable, context) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, [entry.script], {
      cwd: process.cwd(),
      windowsHide: true,
      env: {
        ...process.env,
        AGENT_COMPUTER_USE_SMOKE_APP_ID: entry.appId,
        AGENT_COMPUTER_USE_SMOKE_APP_PATH: executable.path,
        AGENT_COMPUTER_USE_OVERLAY_TARGET_RECT_FILE: context.targetRectFile ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), entry.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolvePromise({
        exitCode,
        durationMs: Math.round(performance.now() - startedAt),
        report: parseReport(exitCode === 0 ? stdout : stderr || stdout),
      });
    });
  });
}

function parseReport(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { status: "failed", reason: "observation.report_invalid" };
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch { return { status: "failed", reason: "observation.report_invalid" }; }
}

function baseResult(entry, values) {
  return {
    appId: entry.appId,
    appName: entry.appName,
    category: entry.category,
    flow: entry.flow,
    capabilitySources: entry.capabilitySources,
    required: entry.required !== false,
    ...values,
    includeUserOverlay: false,
    policyEvents: values.reason ? [values.reason] : [],
    artifacts: [],
  };
}

function sanitizeExecutable(executable) {
  return {
    fileName: executable.fileName ?? basename(executable.path),
    sizeBytes: executable.sizeBytes,
    sha256: executable.sha256,
  };
}

function expandEnvironment(value) {
  return value.replace(/%([^%]+)%/gu, (_, name) => process.env[name] ?? `%${name}%`);
}
