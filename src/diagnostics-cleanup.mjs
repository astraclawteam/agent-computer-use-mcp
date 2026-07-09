import { readdir, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { buildDiagnosticsPolicy } from "./diagnostics-policy.mjs";

const ROOT_SPECS = [
  ["trace", "traceRoot", "traceDays"],
  ["log", "logRoot", "logDays"],
  ["artifact", "artifactRoot", "artifactDays"],
];

export async function cleanupDiagnosticsRetention(options = {}) {
  const policy = options.policy ?? buildDiagnosticsPolicy(options);
  const nowMs = options.nowMs ?? Date.now();
  const dryRun = options.dryRun === true;
  const roots = normalizeAndValidateRoots(policy.roots);
  const expired = [];

  for (const [kind, rootKey, retentionKey] of ROOT_SPECS) {
    const retentionDays = policy.retention?.[retentionKey];
    if (!Number.isFinite(retentionDays)) continue;
    const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
    const root = roots[rootKey];
    const files = await listFilesUnderRoot(root);
    for (const file of files) {
      if (file.mtimeMs <= cutoffMs) {
        expired.push({
          kind,
          path: file.path,
          mtime: new Date(file.mtimeMs).toISOString(),
          retentionDays,
        });
      }
    }
  }

  const deleted = [];
  if (!dryRun) {
    for (const entry of expired) {
      await rm(entry.path, { force: true });
      deleted.push(entry);
    }
  }

  return {
    status: dryRun ? "planned" : "completed",
    phase: "2.5",
    expired,
    deleted,
    deletedCount: deleted.length,
    dryRun,
    includeUserOverlay: false,
  };
}

function normalizeAndValidateRoots(roots) {
  const normalized = {
    traceRoot: resolveRequiredRoot(roots?.traceRoot, "traceRoot"),
    logRoot: resolveRequiredRoot(roots?.logRoot, "logRoot"),
    artifactRoot: resolveRequiredRoot(roots?.artifactRoot, "artifactRoot"),
  };
  const parents = new Set(Object.values(normalized).map((root) => dirname(root).toLowerCase()));
  if (parents.size !== 1) {
    throw new Error("diagnostics_root_outside_policy_family");
  }
  const expectedNames = {
    traceRoot: "traces",
    logRoot: "logs",
    artifactRoot: "artifacts",
  };
  for (const [rootKey, expectedName] of Object.entries(expectedNames)) {
    if (basename(normalized[rootKey]).toLowerCase() !== expectedName) {
      throw new Error("diagnostics_root_kind_mismatch");
    }
  }
  return normalized;
}

function resolveRequiredRoot(root, key) {
  if (!root || typeof root !== "string") {
    throw new Error(`diagnostics_root_required: ${key}`);
  }
  return resolve(root);
}

async function listFilesUnderRoot(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (!isWithinRoot(root, path)) {
      throw new Error("diagnostics_cleanup_path_escape");
    }
    if (entry.isDirectory()) {
      files.push(...await listFilesUnderRoot(path));
    } else if (entry.isFile()) {
      const info = await stat(path);
      files.push({ path, mtimeMs: info.mtimeMs });
    }
  }
  return files;
}

function isWithinRoot(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}
