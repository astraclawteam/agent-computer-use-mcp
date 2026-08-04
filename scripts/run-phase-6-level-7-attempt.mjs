import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { openPhase6LiveMcpSession } from "../src/phase-6-live-mcp-session.mjs";

const labProject = resolve("native-lab/NativeComputerUseLab.csproj");
const labExe = resolve("native-lab/bin/Debug/net10.0-windows/NativeComputerUseLab.exe");
const startedAt = Date.now();
const runRoot = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-6-level-7-"));
const outputFile = join(runRoot, "state.txt");
const expectedText = `phase-6-level-7-${Date.now()}`;

let lab;
let session;

try {
  if (!existsSync(labExe)) await run("dotnet", ["build", labProject]);
  lab = spawn(labExe, [outputFile], {
    stdio: "ignore",
    windowsHide: false,
  });
  await delay(500);

  session = await openPhase6LiveMcpSession();
  const state = await session.callTool("computer.observe", { mode: "state" });
  const application = state.applications?.find((candidate) => (
    /nativecomputeruselab|agent computer use native lab/iu.test(candidate.name ?? "")
  ));
  if (!application) throw new Error("phase6.level7_application_not_discovered");

  const initial = await session.callTool("computer.task", {
    applicationName: application.name,
    goal: "Replace the Name field with the requested exact value without submitting.",
  });
  if (!initial.taskToken || !Array.isArray(initial.candidates)) {
    throw new Error(`phase6.level7_candidates_missing:${initial.phase}`);
  }
  let sceneResult = initial;
  if (initial.phase === "application-selection") {
    const windowCandidate = initial.candidates.find((candidate) => (
      candidate.role === "window"
      && /^Agent Computer Use Native Lab - /u.test(candidate.label ?? "")
    )) ?? initial.candidates.find((candidate) => (
      candidate.role === "application" && candidate.label === application.name
    ));
    if (!windowCandidate) throw new Error("phase6.level7_application_candidate_missing");
    sceneResult = await session.callTool("computer.task", {
      taskToken: initial.taskToken,
      candidateId: windowCandidate.candidateId,
    });
  }
  const editable = sceneResult.candidates?.find((candidate) => (
    candidate.action === "edit"
    && candidate.inputRequired === true
    && /name/iu.test(candidate.label ?? "")
  )) ?? sceneResult.candidates?.find((candidate) => (
    candidate.action === "edit" && candidate.inputRequired === true
  ));
  if (!editable) throw new Error(`phase6.level7_editable_not_offered:${sceneResult.phase}`);

  const edited = await session.callTool("computer.task", {
    taskToken: sceneResult.taskToken,
    candidateId: editable.candidateId,
    text: expectedText,
  });
  const terminalState = await session.callTool("computer.observe", { mode: "state" });
  const elapsedMs = Date.now() - startedAt;
  const passed = edited.outcome === "committed"
    && edited.released === true
    && edited.terminalControllerState === "idle"
    && edited.toolErrorCount === 0
    && edited.wrongSendCount === 0
    && edited.action?.receipt?.postconditionVerified === true
    && terminalState.status === "idle"
    && terminalState.activeController == null
    && elapsedMs <= 60_000;
  const result = {
    status: passed ? "passed" : "failed",
    levelId: "other-windows-app",
    elapsedMs,
    outcome: edited.outcome,
    postconditionVerified: edited.action?.receipt?.postconditionVerified === true,
    terminalControllerState: terminalState.status,
    released: edited.released === true
      && terminalState.status === "idle"
      && terminalState.activeController == null,
    toolErrorCount: edited.toolErrorCount,
    wrongSendCount: edited.wrongSendCount,
    ...(passed ? {} : {
      diagnostic: {
        phase: edited.phase,
        action: edited.action,
        errorCode: edited.error?.code,
        errorMessage: edited.error?.message,
        errorCause: edited.error?.cause,
      },
    }),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "failed",
    levelId: "other-windows-app",
    error: error instanceof Error ? error.message : String(error),
    serverStderr: session?.stderrText().slice(-2_000) ?? "",
  })}\n`);
  process.exitCode = 1;
} finally {
  await session?.close("phase-6-level-7-finally").catch(() => {});
  if (lab && !lab.killed) lab.kill();
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
