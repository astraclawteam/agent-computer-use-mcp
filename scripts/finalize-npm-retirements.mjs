#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertNoCutoverReleaseDefinition, validateRetirementRecords } from "./block-source-publish.mjs";

const IDENTITIES = Object.freeze(["agent-computer-use-mcp", "@xiaozhiclaw/agent-computer-use-win32-x64"]);

export async function finalizeComputerUseNpmRetirements({
  repoRoot = resolve(import.meta.dirname, ".."),
  promotionDate,
  apply = false,
} = {}) {
  if (!realDate(promotionDate)) throw new Error("promotionDate must be explicit YYYY-MM-DD");
  const root = resolve(repoRoot);
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.private !== true || manifest.publishConfig !== undefined) throw new Error("Computer Use source package must be private");
  const scripts = manifest.scripts ?? {};
  const forbiddenScripts = Object.entries(scripts).filter(([name, command]) => (
    name !== "prepublishOnly" && (/publish|release:npm|pack/iu.test(name) || /\b(?:npm|pnpm|yarn)\s+(?:pack|publish)\b/iu.test(String(command)))
  ));
  const forbiddenFiles = [
    "scripts/release-npm-package.mjs",
    "scripts/post-publish-smoke.mjs",
    "scripts/validate-npm-auth-token.mjs",
    "src/platform-package-contract.mjs",
  ].filter((path) => existsSync(join(root, path)));
  if (forbiddenScripts.length || forbiddenFiles.length) throw new Error("Computer Use publication machinery must be absent before retirement finalization");

  const retirementPath = join(root, "npm-retirements.json");
  const records = validateRetirementRecords(JSON.parse(await readFile(retirementPath, "utf8")));
  const byName = new Map(records.map((record) => [record.package, record]));
  if (records.length !== IDENTITIES.length || IDENTITIES.some((name) => !byName.has(name))) {
    throw new Error("Computer Use retirement manifest must contain the exact two outgoing identities");
  }
  let alreadyEffective = true;
  for (const name of IDENTITIES) {
    const record = byName.get(name);
    if (record.cutover === false && record.effectiveDate === null) alreadyEffective = false;
    else if (record.cutover !== true || record.effectiveDate !== promotionDate) throw new Error(`${name} already uses a different promotion date`);
  }
  if (!apply || alreadyEffective) return { applied: false, packages: [...IDENTITIES], promotionDate };

  const updated = records.map((record) => IDENTITIES.includes(record.package)
    ? { ...record, effectiveDate: promotionDate, cutover: true }
    : record);
  assertNoCutoverReleaseDefinition(updated, root);
  const temporaryPath = `${retirementPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(temporaryPath, retirementPath);
  return { applied: true, packages: [...IDENTITIES], promotionDate };
}

function realDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const apply = process.argv.includes("--apply");
  const dateArgument = process.argv.find((value) => value.startsWith("--promotion-date="));
  const unknown = process.argv.slice(2).filter((value) => value !== "--apply" && value !== dateArgument);
  if (!dateArgument || unknown.length) throw new Error("Usage: node scripts/finalize-npm-retirements.mjs --promotion-date=YYYY-MM-DD [--apply]");
  const result = await finalizeComputerUseNpmRetirements({ promotionDate: dateArgument.slice("--promotion-date=".length), apply });
  console.log(JSON.stringify(result));
}
