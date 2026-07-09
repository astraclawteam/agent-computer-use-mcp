import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  buildDiagnosticsPolicy,
  redactDiagnosticValue,
} from "../src/diagnostics-policy.mjs";

test("diagnostics policy derives trace, log, and artifact directories from install layout", () => {
  const policy = buildDiagnosticsPolicy({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
  });

  assert.equal(policy.status, "ready");
  assert.deepEqual(policy.roots, {
    artifactRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\artifacts",
    logRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\logs",
    traceRoot: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\traces",
  });
  assert.equal(policy.retention.traceDays, 14);
  assert.equal(policy.retention.logDays, 30);
  assert.equal(policy.retention.artifactDays, 7);
  assert.equal(policy.includeUserOverlay, false);
});

test("diagnostics redaction removes secrets and personal local paths recursively", () => {
  const redacted = redactDiagnosticValue({
    token: "ghp_1234567890SECRET",
    Authorization: "Bearer secret-token",
    password: "correct-horse",
    nested: {
      apiKey: "sk-secret",
      path: "C:\\Users\\alice\\AppData\\Local\\AgentComputerUse\\logs\\trace.jsonl",
      safe: "ok",
    },
    items: [
      { refreshToken: "refresh-secret" },
      "C:\\Users\\bob\\Desktop\\secret.txt",
    ],
  });

  assert.equal(redacted.token, "[REDACTED]");
  assert.equal(redacted.Authorization, "[REDACTED]");
  assert.equal(redacted.password, "[REDACTED]");
  assert.equal(redacted.nested.apiKey, "[REDACTED]");
  assert.equal(redacted.nested.path, "C:\\Users\\[USER]\\AppData\\Local\\AgentComputerUse\\logs\\trace.jsonl");
  assert.equal(redacted.nested.safe, "ok");
  assert.equal(redacted.items[0].refreshToken, "[REDACTED]");
  assert.equal(redacted.items[1], "C:\\Users\\[USER]\\Desktop\\secret.txt");
});

test("Phase 2.3 has an executable diagnostics policy smoke script", async () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["phase:2.3"], "node src/phase-2-3-diagnostics-policy.mjs");

  const result = await runNode(["src/phase-2-3-diagnostics-policy.mjs"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "2.3");
  assert.equal(report.benchmark, "diagnostics-policy");
  assert.equal(report.includeUserOverlay, false);
  assert.equal(report.redaction.secretRedacted, true);
  assert.equal(report.redaction.localUserPathRedacted, true);
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
