import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  createTraceWriter,
} from "../src/trace-writer.mjs";

test("trace writer appends redacted JSONL events under the trace root", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-trace-"));
  const writer = createTraceWriter({
    traceRoot: root,
    clock: { iso: () => "2026-07-09T00:00:00.000Z" },
  });

  const written = await writer.writeEvent("computer.repair.requested", {
    token: "ghp_secret",
    path: "C:\\Users\\alice\\AppData\\Local\\AgentComputerUse\\traces\\trace.jsonl",
    includeUserOverlay: false,
  });

  assert.equal(written.status, "written");
  assert.equal(written.includeUserOverlay, false);
  assert.match(written.path, /trace-\d{4}-\d{2}-\d{2}\.jsonl$/);

  const lines = (await readFile(written.path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.type, "computer.repair.requested");
  assert.equal(event.ts, "2026-07-09T00:00:00.000Z");
  assert.equal(event.payload.token, "[REDACTED]");
  assert.equal(event.payload.path, "C:\\Users\\[USER]\\AppData\\Local\\AgentComputerUse\\traces\\trace.jsonl");
  assert.equal(event.includeUserOverlay, false);
});

test("trace writer rejects screenshot and overlay payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-trace-"));
  const writer = createTraceWriter({ traceRoot: root });

  await assert.rejects(
    () => writer.writeEvent("computer.capture.created", {
      screenshotBase64: "abc",
      includeUserOverlay: false,
    }),
    /payload_forbidden/,
  );
  await assert.rejects(
    () => writer.writeEvent("computer.overlay.rendered", {
      overlayPixels: "abc",
      includeUserOverlay: true,
    }),
    /payload_forbidden/,
  );
});

test("Phase 2.4 has an executable trace writer smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.4"], "node src/phase-2-4-trace-writer.mjs");

  const result = await runNode(["src/phase-2-4-trace-writer.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.4");
  assert.equal(report.benchmark, "redacted-jsonl-trace-writer");
  assert.equal(report.redaction.secretRedacted, true);
  assert.equal(report.redaction.localUserPathRedacted, true);
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.screenshotPayloadRejected, true);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
