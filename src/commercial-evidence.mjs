import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

const CHECKSUMS_FILE = "checksums.txt";
const REQUIRED_FILES = ["events.jsonl", "report.json", "run-manifest.json"];
const FORBIDDEN_KEY_SUFFIX = /(?:token|secret|password|credential|username|hostname|ipaddress|environment|commandline|executablepath|homepath)$/u;
const FORBIDDEN_VALUES = [
  /(?:ghp|github_pat|gitee)_[A-Za-z0-9_-]{6,}/u,
  /[A-Za-z]:[\\/]Users[\\/][^\\/]+/iu,
  /(?:^|[\s"'])\/home\/[^/\s"']+/u,
  /(?:^|[\s"'])\/Users\/[^/\s"']+/u,
];

export async function createEvidenceRun(options = {}) {
  const root = resolveRequiredPath(options.root, "evidence.root_required");
  const runId = validateRunId(options.runId);
  const runPath = resolve(root, runId);
  assertInside(root, runPath);
  const manifest = { ...(options.manifest ?? {}), runId };
  assertSafeMetadata(manifest);
  await mkdir(root, { recursive: true });
  await mkdir(runPath);
  await atomicWriteJson(join(runPath, "run-manifest.json"), manifest);
  await writeFile(join(runPath, "events.jsonl"), "", { encoding: "utf8", flag: "wx" });
  return new EvidenceRun({ path: runPath, now: options.now });
}

export async function verifyEvidenceDirectory(path, expected = undefined) {
  const runPath = resolveRequiredPath(path, "evidence.path_required");
  const violations = [];
  let manifest = null;
  let report = null;
  let eventCount = 0;
  let checksumEntries = [];

  try {
    manifest = parseJson(await readFile(join(runPath, "run-manifest.json"), "utf8"), "run-manifest.json");
    report = parseJson(await readFile(join(runPath, "report.json"), "utf8"), "report.json");
    eventCount = await verifyEventsFile(join(runPath, "events.jsonl"));
    checksumEntries = parseChecksums(await readFile(join(runPath, CHECKSUMS_FILE), "utf8"));
    assertSafeMetadata(manifest);
    assertSafeMetadata(report);
  } catch (error) {
    violations.push({ code: "evidence.invalid", message: errorMessage(error) });
  }

  let actualFiles = [];
  try {
    actualFiles = await inventoryFiles(runPath, { exclude: new Set([CHECKSUMS_FILE]) });
  } catch (error) {
    violations.push({ code: "evidence.inventory_invalid", message: errorMessage(error) });
  }

  const checksumsByPath = new Map(checksumEntries.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actualFiles.map((entry) => [entry.path, entry]));
  for (const file of actualFiles) {
    const expectedFile = checksumsByPath.get(file.path);
    if (!expectedFile) {
      violations.push({ code: "evidence.unreferenced_file", path: file.path });
    } else if (expectedFile.sha256 !== file.sha256 || expectedFile.bytes !== file.bytes) {
      violations.push({
        code: "evidence.hash_mismatch",
        path: file.path,
        expectedSha256: expectedFile.sha256,
        actualSha256: file.sha256,
        expectedBytes: expectedFile.bytes,
        actualBytes: file.bytes,
      });
    }
  }
  for (const entry of checksumEntries) {
    if (!actualByPath.has(entry.path)) violations.push({ code: "evidence.referenced_file_missing", path: entry.path });
  }
  for (const required of REQUIRED_FILES) {
    if (!actualByPath.has(required)) violations.push({ code: "evidence.required_file_missing", path: required });
  }
  if (expected && manifest) compareExpected(manifest, expected, "", violations);

  return {
    schemaVersion: 1,
    status: violations.length === 0 ? "passed" : "failed",
    runId: manifest?.runId ?? null,
    eventCount,
    files: checksumEntries,
    report,
    violations,
  };
}

class EvidenceRun {
  #now;
  #queue = Promise.resolve();
  #sealed = false;
  #sequence = 0;

  constructor(options) {
    this.path = options.path;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  append(type, payload = {}) {
    if (this.#sealed) return Promise.reject(new Error("evidence.run_sealed"));
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u.test(type)) {
      return Promise.reject(new Error("evidence.event_type_invalid"));
    }
    assertSafeMetadata(payload);
    const operation = this.#queue.then(async () => {
      if (this.#sealed) throw new Error("evidence.run_sealed");
      const event = {
        schemaVersion: 1,
        sequence: ++this.#sequence,
        timestamp: normalizeTimestamp(this.#now()),
        type,
        payload,
      };
      await writeFile(join(this.path, "events.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
      return event;
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }

  checkpoint(payload = {}) {
    return this.append("evidence.checkpoint", payload);
  }

  async seal(report) {
    if (this.#sealed) throw new Error("evidence.run_sealed");
    this.#sealed = true;
    await this.#queue;
    assertSafeMetadata(report);
    await atomicWriteJson(join(this.path, "report.json"), report);
    const files = await inventoryFiles(this.path, { exclude: new Set([CHECKSUMS_FILE]) });
    await atomicWriteText(join(this.path, CHECKSUMS_FILE), formatChecksums(files));
    return { path: this.path, files };
  }
}

async function inventoryFiles(root, options = {}) {
  const exclude = options.exclude ?? new Set();
  const paths = [];
  await walk(root, "", paths, exclude);
  const files = [];
  for (const path of paths.sort()) {
    const fullPath = join(root, ...path.split("/"));
    const fileStat = await lstat(fullPath);
    files.push({ path, bytes: fileStat.size, sha256: await sha256File(fullPath) });
  }
  return files;
}

async function walk(root, relativeRoot, output, exclude) {
  const directory = relativeRoot ? join(root, ...relativeRoot.split("/")) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (exclude.has(path)) continue;
    const fullPath = join(directory, entry.name);
    const fileStat = await lstat(fullPath);
    if (fileStat.isSymbolicLink()) throw new Error(`evidence.symlink_forbidden: ${path}`);
    if (fileStat.isDirectory()) await walk(root, path, output, exclude);
    else if (fileStat.isFile()) output.push(path);
    else throw new Error(`evidence.file_type_forbidden: ${path}`);
  }
}

async function verifyEventsFile(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let eventCount = 0;
  try {
    for await (const line of lines) {
      if (line.length === 0) continue;
      eventCount += 1;
      const event = parseJson(line, `events.jsonl:${eventCount}`);
      if (event.sequence !== eventCount) throw new Error("evidence.event_sequence_invalid");
      assertSafeMetadata(event);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return eventCount;
}

function parseChecksums(text) {
  const entries = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  (\d+)  ([^\\]+)$/u.exec(line);
    if (!match) throw new Error("evidence.checksums_invalid");
    const path = match[3].replaceAll("\\", "/");
    validateRelativeFile(path);
    if (seen.has(path)) throw new Error("evidence.checksum_duplicate");
    seen.add(path);
    entries.push({ path, bytes: Number(match[2]), sha256: match[1] });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function formatChecksums(files) {
  return `${files.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join("\n")}\n`;
}

function compareExpected(actual, expected, prefix, violations) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const actualValue = actual?.[key];
    if (expectedValue && typeof expectedValue === "object" && !Array.isArray(expectedValue)) {
      compareExpected(actualValue, expectedValue, path, violations);
    } else if (!Object.is(actualValue, expectedValue)) {
      violations.push({ code: "evidence.identity_mismatch", path, expected: expectedValue, actual: actualValue });
    }
  }
}

function assertSafeMetadata(value, path = "$") {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (FORBIDDEN_VALUES.some((pattern) => pattern.test(value))) throw new Error(`evidence.forbidden_metadata: ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeMetadata(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object") throw new Error(`evidence.metadata_type_invalid: ${path}`);
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenKey(key)) throw new Error(`evidence.forbidden_metadata: ${path}.${key}`);
    assertSafeMetadata(child, `${path}.${key}`);
  }
}

function isForbiddenKey(key) {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
  return normalized === "ip" || normalized === "env" || FORBIDDEN_KEY_SUFFIX.test(normalized);
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

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function validateRunId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error("evidence.run_id_invalid");
  }
  return value;
}

function validateRelativeFile(path) {
  if (!path || isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("evidence.path_invalid");
  }
}

function resolveRequiredPath(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(code);
  return resolve(value);
}

function assertInside(root, candidate) {
  const path = relative(root, candidate);
  if (!path || path.startsWith(`..${sep}`) || path === ".." || isAbsolute(path)) throw new Error("evidence.path_invalid");
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value.toISOString() : String(value);
  if (Number.isNaN(Date.parse(timestamp))) throw new Error("evidence.timestamp_invalid");
  return timestamp;
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`evidence.json_invalid: ${source}: ${errorMessage(error)}`);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
