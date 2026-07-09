import {
  buildDiagnosticsPolicy,
  redactDiagnosticValue,
} from "./diagnostics-policy.mjs";

const policy = buildDiagnosticsPolicy();
const redacted = redactDiagnosticValue({
  token: "ghp_example_secret",
  path: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\logs\\trace.jsonl",
});

const passed = policy.status === "ready"
  && policy.includeUserOverlay === false
  && redacted.token === "[REDACTED]"
  && redacted.path === "C:\\Users\\[USER]\\AppData\\Local\\AgentComputerUse\\logs\\trace.jsonl";

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.3",
  benchmark: "diagnostics-policy",
  roots: policy.roots,
  retention: policy.retention,
  includeUserOverlay: policy.includeUserOverlay,
  redaction: {
    secretRedacted: redacted.token === "[REDACTED]",
    localUserPathRedacted: redacted.path.includes("C:\\Users\\[USER]"),
  },
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;
