import assert from "node:assert/strict";
import { test } from "node:test";

import { probeOwnedRuntime } from "../src/windows-runtime-probe.mjs";

test("probe reports only the owned process tree and its listening ports", async () => {
  const result = await probeOwnedRuntime({
    rootPids: [10],
    runPowerShell: async ({ rootPids, script }) => {
      assert.deepEqual(rootPids, [10]);
      assert.match(script, /Get-CimInstance Win32_Process/u);
      assert.match(script, /Get-NetTCPConnection/u);
      return JSON.stringify({
        processes: [
          { pid: 10, parentPid: 1, name: "node.exe", rssBytes: 100, handles: 10, commandLine: "secret", executablePath: "C:/private/node.exe" },
          { pid: 11, parentPid: 10, name: "AgentComputerUse.GatewayOverlay.exe", rssBytes: 200, handles: 20 },
          { pid: 99, parentPid: 1, name: "unrelated.exe", rssBytes: 999, handles: 99 },
        ],
        listeners: [
          { pid: 11, port: 43123 },
          { pid: 99, port: 80 },
        ],
      });
    },
  });

  assert.deepEqual(result.processIds, [10, 11]);
  assert.deepEqual(result.listeningPorts, [43123]);
  assert.equal(result.rssBytes, 300);
  assert.equal(result.handles, 30);
  assert.deepEqual(result.overlayProcessIds, [11]);
  assert.deepEqual(result.cursorProcessIds, []);
  assert.equal(result.processes[0].commandLine, undefined);
  assert.equal(result.processes[0].executablePath, undefined);
});

test("probe follows descendants independent of input row order", async () => {
  const result = await probeOwnedRuntime({
    rootPids: [20],
    runPowerShell: async () => JSON.stringify({
      processes: [
        { pid: 22, parentPid: 21, name: "agent-cursor.exe", rssBytes: 3, handles: 3 },
        { pid: 21, parentPid: 20, name: "cua-driver.exe", rssBytes: 2, handles: 2 },
        { pid: 20, parentPid: 1, name: "node.exe", rssBytes: 1, handles: 1 },
      ],
      listeners: [],
    }),
  });
  assert.deepEqual(result.processIds, [20, 21, 22]);
  assert.deepEqual(result.cursorProcessIds, [22]);
});

test("probe rejects invalid roots and malformed PowerShell output", async () => {
  await assert.rejects(() => probeOwnedRuntime({ rootPids: [0] }), /runtime.probe_pid_invalid/);
  await assert.rejects(() => probeOwnedRuntime({ rootPids: [10, 10] }), /runtime.probe_pid_duplicate/);
  await assert.rejects(
    () => probeOwnedRuntime({ rootPids: [10], runPowerShell: async () => "not-json" }),
    /runtime.probe_output_invalid/,
  );
});

test("probe returns an empty sanitized sample when no roots are active", async () => {
  let invoked = false;
  const result = await probeOwnedRuntime({
    rootPids: [],
    runPowerShell: async () => { invoked = true; },
  });
  assert.equal(invoked, false);
  assert.deepEqual(result, {
    processIds: [],
    processes: [],
    rssBytes: 0,
    handles: 0,
    listeningPorts: [],
    overlayProcessIds: [],
    cursorProcessIds: [],
  });
});

test("probe matches process identity constraints instead of trusting a reused PID", async () => {
  const original = await probeOwnedRuntime({
    rootProcesses: [{ pid: 10, startedAtMs: 900 }],
    runPowerShell: async () => JSON.stringify({
      processes: [
        { pid: 10, parentPid: 1, name: "node.exe", startedAtMs: 900, rssBytes: 100, handles: 10 },
        { pid: 11, parentPid: 10, name: "conhost.exe", startedAtMs: 901, rssBytes: 20, handles: 2 },
      ],
      listeners: [],
    }),
  });
  const reused = await probeOwnedRuntime({
    rootProcesses: [{ pid: 10, notCreatedAfterMs: 1_000 }],
    runPowerShell: async () => JSON.stringify({
      processes: [
        { pid: 10, parentPid: 1, name: "unrelated.exe", startedAtMs: 2_000, rssBytes: 999, handles: 99 },
        { pid: 12, parentPid: 10, name: "unrelated-child.exe", startedAtMs: 2_001, rssBytes: 999, handles: 99 },
      ],
      listeners: [],
    }),
  });

  assert.deepEqual(original.processIds, [10, 11]);
  assert.deepEqual(reused.processIds, []);
  assert.equal(reused.handles, 0);
});

test("probe excludes stale PPID descendants created before a reused root process", async () => {
  const result = await probeOwnedRuntime({
    rootPids: [20],
    runPowerShell: async () => JSON.stringify({
      processes: [
        { pid: 20, parentPid: 1, name: "node.exe", startedAtMs: 2_000, rssBytes: 100, handles: 10 },
        { pid: 21, parentPid: 20, name: "stale-service.exe", startedAtMs: 1_000, rssBytes: 9_000, handles: 900 },
        { pid: 22, parentPid: 21, name: "stale-child.exe", startedAtMs: 1_100, rssBytes: 9_000, handles: 900 },
        { pid: 23, parentPid: 20, name: "conhost.exe", startedAtMs: 2_001, rssBytes: 20, handles: 2 },
      ],
      listeners: [
        { pid: 21, port: 8080 },
        { pid: 23, port: 43123 },
      ],
    }),
  });

  assert.deepEqual(result.processIds, [20, 23]);
  assert.deepEqual(result.listeningPorts, [43123]);
  assert.equal(result.handles, 12);
});
