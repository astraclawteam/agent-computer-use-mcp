import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { REAL_APP_RESULT_STATUSES, parseRealAppCatalog } from "./real-app-catalog.mjs";

const TRANSIENT_REASONS = new Set([
  "app.smoke_timeout",
  "driver.transport_interrupted",
  "window.transient_unavailable",
]);

export async function runRealAppSmokeCatalog(options = {}) {
  if (options.catalog?.schemaVersion === 2) return runSchemaV2Catalog(options);
  return runLegacyCatalog(options);
}

async function runLegacyCatalog(options = {}) {
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
      const maxAttempts = entry.maxAttempts ?? 1;
      let attemptCount = 0;
      let execution;
      do {
        attemptCount += 1;
        execution = await execute(entry, executable, { targetRectFile: overlay?.targetRectFile });
      } while (attemptCount < maxAttempts && isRetryableExecution(execution));
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
        attemptCount,
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

async function runSchemaV2Catalog(options) {
  const catalog = parseRealAppCatalog(options.catalog);
  const filters = normalizeFilters(options.filters);
  const entries = catalog.apps.filter((entry) => matchesFilters(entry, filters));
  const executeAdapter = options.executeAdapter;
  if (typeof executeAdapter !== "function") throw new Error("app.adapter_executor_required");
  const overlay = options.startOverlay ? await options.startOverlay() : null;
  const results = [];
  try {
    for (const entry of entries) {
      const attempts = [];
      let attempt = await executeAdapter(entry, { attemptNumber: 1, targetRectFile: overlay?.targetRectFile });
      attempts.push(sanitizeAttempt(attempt, 1));
      if (isTransient(attempt)) {
        attempt = await executeAdapter(entry, { attemptNumber: 2, targetRectFile: overlay?.targetRectFile });
        attempts.push(sanitizeAttempt(attempt, 2));
      }
      const finalAttempt = attempts.at(-1);
      const repeatedTransient = attempts.length === 2 && attempts.every((item) => isTransient(item));
      const result = Object.freeze({
        appId: entry.appId,
        appName: entry.appName,
        category: entry.category,
        role: entry.role,
        expectedStatus: entry.expectedStatus,
        status: repeatedTransient ? "product-failure" : finalAttempt.status,
        reason: repeatedTransient ? "app.repeated_transient_failure" : finalAttempt.reason,
        attempts: Object.freeze(attempts),
      });
      results.push(result);
      await options.evidenceRun?.append("application.attempts-completed", {
        appId: entry.appId,
        role: entry.role,
        status: result.status,
        attemptCount: attempts.length,
      });
    }
  } finally {
    await overlay?.stop?.();
  }

  const counts = Object.fromEntries(REAL_APP_RESULT_STATUSES.map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]));
  const fullMatrix = filters.roles.length === 0 && filters.appIds.length === 0;
  const report = Object.freeze({
    schemaVersion: 2,
    phase: "6.2",
    benchmark: "real-app-perception-smoke",
    status: results.every((result) => result.status === result.expectedStatus) ? "passed" : "failed",
    fullMatrix,
    filters,
    selectedCount: entries.length,
    catalogCount: catalog.apps.length,
    counts,
    results: Object.freeze(results),
    includeUserOverlay: false,
  });
  await options.evidenceRun?.seal(report);
  return report;
}

function normalizeFilters(value = {}) {
  const roles = [...new Set(value.roles ?? [])].sort();
  const appIds = [...new Set(value.appIds ?? [])].sort();
  return Object.freeze({ roles: Object.freeze(roles), appIds: Object.freeze(appIds) });
}

function matchesFilters(entry, filters) {
  return (filters.roles.length === 0 || filters.roles.includes(entry.role))
    && (filters.appIds.length === 0 || filters.appIds.includes(entry.appId));
}

function sanitizeAttempt(attempt, attemptNumber) {
  const status = REAL_APP_RESULT_STATUSES.includes(attempt?.status) ? attempt.status : "product-failure";
  return Object.freeze({
    attemptNumber,
    status,
    reason: typeof attempt?.reason === "string" ? attempt.reason : null,
    cleanup: attempt?.cleanup?.status === "passed"
      ? Object.freeze({ status: "passed" })
      : Object.freeze({ status: "failed", reason: attempt?.cleanup?.reason ?? "app.cleanup_failed" }),
    ...(attempt?.finalState ? { finalState: Object.freeze({ ...attempt.finalState }) } : {}),
    ...(attempt?.executable ? { executable: Object.freeze({
      fileName: attempt.executable.fileName,
      version: attempt.executable.version,
      sizeBytes: attempt.executable.sizeBytes,
      sha256: attempt.executable.sha256,
    }) } : {}),
  });
}

function isTransient(attempt) {
  return attempt?.status === "infrastructure-error" && TRANSIENT_REASONS.has(attempt.reason);
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
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, entry.timeoutMs ?? 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolvePromise({
        exitCode,
        timedOut,
        durationMs: Math.round(performance.now() - startedAt),
        report: timedOut
          ? { status: "failed", reason: "app.smoke_timeout" }
          : parseReport(exitCode === 0 ? stdout : stderr || stdout),
      });
    });
  });
}

function isRetryableExecution(execution) {
  return execution.timedOut === true
    || ["app.smoke_timeout", "driver.transport_interrupted", "window.transient_unavailable"]
      .includes(execution.report?.reason);
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
