import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RETIREMENT_FIELDS = ["package", "replacement", "message", "effectiveDate", "cutover"];
const PUBLIC_IDENTITIES = new Set(["agent-computer-use-mcp", "@xiaozhiclaw/agent-computer-use-win32-x64"]);

function realDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function validateRetirementRecords(value) {
  if (!Array.isArray(value)) throw new Error("retirement records must be a JSON array");
  const names = new Set();
  for (const record of value) {
    const fields = record && typeof record === "object" && !Array.isArray(record) ? Object.keys(record) : [];
    const exactFields = fields.length === RETIREMENT_FIELDS.length && RETIREMENT_FIELDS.every((field) => fields.includes(field));
    const validValues = exactFields
      && typeof record.package === "string" && record.package.trim().length > 0
      && (record.replacement === null || typeof record.replacement === "string")
      && typeof record.message === "string" && record.message.trim().length > 0
      && typeof record.effectiveDate === "string" && realDate(record.effectiveDate)
      && typeof record.cutover === "boolean";
    if (!validValues) throw new Error("invalid retirement record; expected exact package, replacement, message, effectiveDate, cutover contract");
    if (names.has(record.package)) throw new Error(`duplicate retirement record: ${record.package}`);
    names.add(record.package);
  }
  return value;
}

export function readRetirementRecords(root = process.cwd()) {
  const path = join(root, "npm-retirements.json");
  if (!existsSync(path)) return [];
  return validateRetirementRecords(JSON.parse(readFileSync(path, "utf8")));
}

function publicationScriptNames(scripts = {}) {
  const names = new Set();
  for (const [name, commandValue] of Object.entries(scripts)) {
    const command = String(commandValue);
    if (/publish/iu.test(name) || /^(?:release:npm:package|npm:release:package)$/iu.test(name) || /\b(?:npm|pnpm|yarn)\s+publish\b/iu.test(command) || /(?:release-npm-package|npm-release-package)\.mjs/iu.test(command)) names.add(name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, commandValue] of Object.entries(scripts)) {
      if (names.has(name)) continue;
      const referenced = [...String(commandValue).matchAll(/\b(?:npm|pnpm|yarn)(?:\s+run)?\s+([\w:.-]+)/giu)].map((match) => match[1]);
      if (referenced.some((scriptName) => names.has(scriptName))) { names.add(name); changed = true; }
    }
  }
  return [...names].sort();
}

export function assertNoCutoverReleaseDefinition(records, root = process.cwd()) {
  validateRetirementRecords(records);
  if (!records.some((record) => record.cutover && PUBLIC_IDENTITIES.has(record.package))) return;
  const manifestPath = join(root, "package.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const machinery = publicationScriptNames(manifest.scripts);
  const releaseFile = join(root, "scripts", "release-npm-package.mjs");
  const platformDefinition = join(root, "src", "platform-package-contract.mjs");
  if (machinery.length > 0 || existsSync(releaseFile) || existsSync(platformDefinition)) {
    const details = [
      ...machinery.map((name) => `${name} -> ${manifest.scripts[name]}`),
      ...(existsSync(releaseFile) ? ["scripts/release-npm-package.mjs"] : []),
      ...(existsSync(platformDefinition) ? ["src/platform-package-contract.mjs"] : []),
    ];
    throw new Error(`agent-computer-use-mcp is cut over but still exposes a release definition: ${details.join(", ")}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assertNoCutoverReleaseDefinition(readRetirementRecords());
  process.stderr.write("release.source_publish_blocked: agent-computer-use-mcp is an outgoing npm identity; publish is blocked from the source workspace\n");
  process.exitCode = 1;
}
