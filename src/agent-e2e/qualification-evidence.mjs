import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import { QUALIFICATION_LANES, REQUIRED_SUCCESSES } from "./qualification-contract.mjs";

export const QUALIFICATION_EVIDENCE_FILES = Object.freeze([
  "run-manifest.json",
  "agent-transcript.jsonl",
  "mcp-tool-events.jsonl",
  "observation-summary.jsonl",
  "verification.json",
  "cleanup.json",
  "checksums.txt",
]);

const CHECKSUMS_FILE = "checksums.txt";
const HASHED_FILES = new Set(QUALIFICATION_EVIDENCE_FILES.filter((path) => path !== CHECKSUMS_FILE));
const FORBIDDEN_KEYS = new Set([
  "arguments",
  "content",
  "credential",
  "image",
  "localpath",
  "message",
  "password",
  "payload",
  "pixels",
  "prompt",
  "rawocr",
  "result",
  "screenshot",
  "secret",
  "text",
  "token",
  "username",
]);
const FORBIDDEN_VALUES = Object.freeze([
  /(?:ghp|github_pat|gitee)_[A-Za-z0-9_-]{6,}/u,
  /[A-Za-z]:[\\/]Users[\\/][^\\/]+/iu,
  /(?:^|[\s"'])\/(?:home|Users)\/[^/\s"']+/u,
  /data:image\//iu,
]);

export async function createQualificationEvidenceRun(options = {}) {
  const root = requiredPath(options.root, "agent_e2e.evidence_root_required");
  const runId = validateRunId(options.runId);
  const runPath = resolve(root, runId);
  assertInside(root, runPath);
  const manifest = { ...(options.manifest ?? {}), retry: options.manifest?.retry ?? 0, runId };
  assertSafeMetadata(manifest);
  assertQualificationManifest(manifest);
  await mkdir(root, { recursive: true });
  await mkdir(runPath);
  await atomicWriteJson(join(runPath, "run-manifest.json"), manifest);
  await Promise.all([
    writeFile(join(runPath, "agent-transcript.jsonl"), "", { encoding: "utf8", flag: "wx" }),
    writeFile(join(runPath, "mcp-tool-events.jsonl"), "", { encoding: "utf8", flag: "wx" }),
    writeFile(join(runPath, "observation-summary.jsonl"), "", { encoding: "utf8", flag: "wx" }),
  ]);
  return new QualificationEvidenceRun({ path: runPath, now: options.now });
}

export async function verifyQualificationEvidence(path, expected = undefined) {
  const runPath = requiredPath(path, "agent_e2e.evidence_path_required");
  const violations = [];
  let manifest = null;
  let verification = null;
  let cleanup = null;
  let checksums = [];
  const counts = { transcript: 0, mcpEvents: 0, observations: 0 };

  try {
    manifest = parseJson(await readFile(join(runPath, "run-manifest.json"), "utf8"));
    assertSafeMetadata(manifest);
    assertQualificationManifest(manifest);
    verification = parseJson(await readFile(join(runPath, "verification.json"), "utf8"));
    cleanup = parseJson(await readFile(join(runPath, "cleanup.json"), "utf8"));
    assertSafeMetadata(verification);
    assertSafeMetadata(cleanup);
    counts.transcript = await verifyJsonLines(join(runPath, "agent-transcript.jsonl"));
    counts.mcpEvents = await verifyJsonLines(join(runPath, "mcp-tool-events.jsonl"));
    counts.observations = await verifyJsonLines(join(runPath, "observation-summary.jsonl"));
    checksums = parseChecksums(await readFile(join(runPath, CHECKSUMS_FILE), "utf8"));
  } catch (error) {
    violations.push({ code: "agent_e2e.evidence_invalid", message: errorMessage(error) });
  }

  let files = [];
  try {
    files = await inventoryFiles(runPath);
    const actualNames = new Set(files.map((entry) => entry.path));
    if (actualNames.size !== QUALIFICATION_EVIDENCE_FILES.length
      || QUALIFICATION_EVIDENCE_FILES.some((name) => !actualNames.has(name))) {
      violations.push({ code: "agent_e2e.evidence_inventory_invalid" });
    }
    const checksumMap = new Map(checksums.map((entry) => [entry.path, entry]));
    for (const file of files.filter((entry) => entry.path !== CHECKSUMS_FILE)) {
      const expectedFile = checksumMap.get(file.path);
      if (!expectedFile || expectedFile.sha256 !== file.sha256 || expectedFile.bytes !== file.bytes) {
        violations.push({ code: "agent_e2e.evidence_hash_mismatch", path: file.path });
      }
    }
    if (checksums.length !== HASHED_FILES.size || checksums.some((entry) => !HASHED_FILES.has(entry.path))) {
      violations.push({ code: "agent_e2e.evidence_checksums_invalid" });
    }
  } catch (error) {
    violations.push({ code: "agent_e2e.evidence_inventory_invalid", message: errorMessage(error) });
  }
  if (expected && manifest) compareExpected(manifest, expected, "", violations);

  return Object.freeze({
    status: violations.length === 0 ? "passed" : "failed",
    runId: manifest?.runId ?? null,
    manifest,
    verification,
    cleanup,
    files: Object.freeze(files),
    counts: Object.freeze(counts),
    violations: Object.freeze(violations.map((entry) => Object.freeze(entry))),
  });
}

class QualificationEvidenceRun {
  #now;
  #queue = Promise.resolve();
  #sealed = false;

  constructor(options) {
    this.path = options.path;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  appendTranscript(payload) {
    return this.#append("agent-transcript.jsonl", payload);
  }

  appendMcpEvent(payload) {
    return this.#append("mcp-tool-events.jsonl", payload);
  }

  appendObservation(payload) {
    return this.#append("observation-summary.jsonl", payload);
  }

  #append(fileName, payload) {
    if (this.#sealed) return Promise.reject(evidenceError("agent_e2e.evidence_sealed"));
    try {
      assertSafeMetadata(payload);
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = this.#queue.then(async () => {
      if (this.#sealed) throw evidenceError("agent_e2e.evidence_sealed");
      const entry = { timestamp: normalizeTimestamp(this.#now()), ...payload };
      assertSafeMetadata(entry);
      await writeFile(join(this.path, fileName), `${JSON.stringify(entry)}\n`, { encoding: "utf8", flag: "a" });
      return Object.freeze(entry);
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  async seal({ verification, cleanup } = {}) {
    if (this.#sealed) throw evidenceError("agent_e2e.evidence_sealed");
    this.#sealed = true;
    await this.#queue;
    assertSafeMetadata(verification);
    assertSafeMetadata(cleanup);
    await atomicWriteJson(join(this.path, "verification.json"), verification);
    await atomicWriteJson(join(this.path, "cleanup.json"), cleanup);
    const files = (await inventoryFiles(this.path)).filter((entry) => entry.path !== CHECKSUMS_FILE);
    await atomicWriteText(join(this.path, CHECKSUMS_FILE), formatChecksums(files));
    return Object.freeze({ path: this.path, files: Object.freeze(files) });
  }
}

async function verifyJsonLines(path) {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (!line) continue;
      count += 1;
      assertSafeMetadata(parseJson(line));
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return count;
}

async function inventoryFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = entry.name;
    const fullPath = join(root, path);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink() || !stat.isFile() || entry.isDirectory()) {
      throw evidenceError("agent_e2e.evidence_file_type_forbidden", path);
    }
    files.push({ path, bytes: stat.size, sha256: await sha256File(fullPath) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function assertSafeMetadata(value, path = "$") {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (FORBIDDEN_VALUES.some((pattern) => pattern.test(value))) throw evidenceError("agent_e2e.evidence_forbidden", path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSafeMetadata(child, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw evidenceError("agent_e2e.evidence_metadata_invalid", path);
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
    if (FORBIDDEN_KEYS.has(normalized)) throw evidenceError("agent_e2e.evidence_forbidden", `${path}.${key}`);
    assertSafeMetadata(child, `${path}.${key}`);
  }
}

function assertQualificationManifest(manifest) {
  const strings = [manifest.campaignId, manifest.taskId, manifest.initialStateSeed];
  if (manifest.evidenceKind !== "real-agent-e2e"
    || strings.some((value) => typeof value !== "string" || value.trim() === "")
    || !QUALIFICATION_LANES.includes(manifest.lane)
    || !Number.isSafeInteger(manifest.repetition) || manifest.repetition < 1 || manifest.repetition > REQUIRED_SUCCESSES
    || !Number.isSafeInteger(manifest.retry) || manifest.retry < 0 || manifest.retry > 1
    || !/^[a-f0-9]{64}$/u.test(manifest.promptSha256 ?? "")
    || !isRecord(manifest.candidateIdentity)
    || !isRecord(manifest.hostIdentity)
    || !isRecord(manifest.modelIdentity)) {
    throw evidenceError("agent_e2e.evidence_manifest_invalid");
  }
}

function parseChecksums(text) {
  const entries = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  (\d+)  ([^\\/]+)$/u.exec(line);
    if (!match || seen.has(match[3])) throw evidenceError("agent_e2e.evidence_checksums_invalid");
    seen.add(match[3]);
    entries.push({ path: match[3], bytes: Number(match[2]), sha256: match[1] });
  }
  return entries;
}

function formatChecksums(files) {
  return `${files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join("\n")}\n`;
}

function compareExpected(actual, expected, prefix, violations) {
  for (const [key, value] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) compareExpected(actual?.[key], value, path, violations);
    else if (!Object.is(actual?.[key], value)) violations.push({ code: "agent_e2e.evidence_identity_mismatch", path });
  }
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

async function atomicWriteJson(path, value) {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWriteText(path, text) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function validateRunId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw evidenceError("agent_e2e.evidence_run_id_invalid");
  }
  return value;
}

function requiredPath(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw evidenceError(code);
  return resolve(value);
}

function assertInside(root, candidate) {
  const path = relative(root, candidate);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw evidenceError("agent_e2e.evidence_path_invalid");
  }
}

function parseJson(text) {
  return JSON.parse(text);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimestamp(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function evidenceError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
