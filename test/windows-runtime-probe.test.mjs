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
