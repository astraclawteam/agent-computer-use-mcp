import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";

const execFileAsync = promisify(execFile);
const roots = [];
const script = join(import.meta.dirname, "..", "scripts", "restore-gitee-release.ps1");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("Gitee recovery verifies exact assets and reconstructs chunked originals", async () => {
  const { input, output } = await fixture();
  await writeFile(join(input, "small.txt"), "small");
  await writeFile(join(input, "large.zip.part001"), "ABCD");
  await writeFile(join(input, "large.zip.part002"), "EF");
  await writeManifest(input, [
    original("small.txt", "small", "exact", [attachment("small.txt", "small")]),
    original("large.zip", "ABCDEF", "chunked", [
      attachment("large.zip.part001", "ABCD"),
      attachment("large.zip.part002", "EF"),
    ]),
  ]);

  const result = await runRestore(input, output);

  assert.match(result.stdout, /gitee\.restore_passed/u);
  assert.equal(await readFile(join(output, "small.txt"), "utf8"), "small");
  assert.equal(await readFile(join(output, "large.zip"), "utf8"), "ABCDEF");
});

test("Gitee recovery fails closed on a corrupt part without promoting output", async () => {
  const { input, output } = await fixture();
  await writeFile(join(input, "large.zip.part001"), "changed");
  await writeFile(join(input, "large.zip.part002"), "EFGH");
  await writeManifest(input, [
    original("large.zip", "ABCDEFGH", "chunked", [
      attachment("large.zip.part001", "ABCD"),
      attachment("large.zip.part002", "EFGH"),
    ]),
  ]);

  await assert.rejects(runRestore(input, output), /gitee\.attachment_identity_mismatch/u);
  await assert.rejects(readFile(join(output, "large.zip")), /ENOENT/u);
});

test("Gitee recovery rejects manifest traversal and existing chunked output", async () => {
  const first = await fixture();
  await writeFile(join(first.input, "part001"), "ABCD");
  await writeManifest(first.input, [
    original("..\\escape.zip", "ABCD", "chunked", [attachment("part001", "ABCD")]),
  ]);
  await assert.rejects(runRestore(first.input, first.output), /gitee\.manifest_name_invalid/u);

  const second = await fixture();
  await writeFile(join(second.input, "large.zip.part001"), "ABCD");
  await writeFile(join(second.input, "large.zip.part002"), "EFGH");
  await writeFile(join(second.output, "large.zip"), "existing");
  await writeManifest(second.input, [
    original("large.zip", "ABCDEFGH", "chunked", [
      attachment("large.zip.part001", "ABCD"),
      attachment("large.zip.part002", "EFGH"),
    ]),
  ]);
  await assert.rejects(runRestore(second.input, second.output), /gitee\.output_exists/u);
  assert.equal(await readFile(join(second.output, "large.zip"), "utf8"), "existing");
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gitee-restore-"));
  roots.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(input);
  await mkdir(output);
  return { input, output };
}

async function writeManifest(root, originals) {
  await writeFile(join(root, "gitee-mirror-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    tag: "v0.0.1",
    sourceCommit: "a".repeat(40),
    partSizeBytes: 4,
    originals,
  }, null, 2)}\n`);
}

async function runRestore(input, output) {
  return execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-InputRoot", input,
    "-OutputRoot", output,
  ], { encoding: "utf8" });
}

function original(name, contents, representation, attachments) {
  return {
    name,
    sizeBytes: Buffer.byteLength(contents),
    sha256: sha(contents),
    representation,
    attachments,
  };
}

function attachment(name, contents) {
  return { name, sizeBytes: Buffer.byteLength(contents), sha256: sha(contents) };
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
