import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTraceWriter } from "./trace-writer.mjs";

const traceRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-2-4-"));
const writer = createTraceWriter({
  traceRoot,
  clock: { iso: () => "2026-07-09T00:00:00.000Z" },
});

let screenshotPayloadRejected = false;
const written = await writer.writeEvent("computer.doctor.completed", {
  token: "ghp_example_secret",
  path: "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse\\traces\\trace.jsonl",
  includeUserOverlay: false,
});

try {
  await writer.writeEvent("computer.capture.created", {
    screenshotBase64: "abc",
    includeUserOverlay: false,
  });
} catch (error) {
  screenshotPayloadRejected = String(error instanceof Error ? error.message : error).includes("payload_forbidden");
}

const line = (await readFile(written.path, "utf8")).trim();
const event = JSON.parse(line);
const passed = event.payload.token === "[REDACTED]"
  && event.payload.path === "C:\\Users\\[USER]\\AppData\\Local\\AgentComputerUse\\traces\\trace.jsonl"
  && event.includeUserOverlay === false
  && screenshotPayloadRejected;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "2.4",
  benchmark: "redacted-jsonl-trace-writer",
  tracePath: written.path,
  includeUserOverlay: event.includeUserOverlay,
  redaction: {
    secretRedacted: event.payload.token === "[REDACTED]",
    localUserPathRedacted: event.payload.path.includes("C:\\Users\\[USER]"),
  },
  screenshotPayloadRejected,
}, null, 2)}\n`);

process.exitCode = passed ? 0 : 1;
