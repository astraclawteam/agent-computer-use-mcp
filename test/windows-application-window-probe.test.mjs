import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { queryWindowsApplicationWindows } from "../src/windows-application-window-probe.mjs";

test("application window probe keeps exact process ownership and hidden HWND facts", async () => {
  let request;
  let encodedProbe;
  const spawnProcess = (_command, args, options) => {
    assert.equal(options.windowsHide, true);
    encodedProbe = args.at(-1);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.kill = () => {};
    child.stdin.end = (value) => {
      request = JSON.parse(value);
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(JSON.stringify([
          {
            WindowId: 91,
            ProcessId: 505,
            Title: "",
            ClassName: "ApplicationFrame",
            OwnerWindowId: 0,
            Visible: false,
            Minimized: false,
            Enabled: true,
            ToolWindow: false,
            Cloaked: false,
            X: -32000,
            Y: -32000,
            Width: 960,
            Height: 720,
          },
          {
            WindowId: 92,
            ProcessId: 999,
            Title: "foreign",
            Width: 800,
            Height: 600,
            X: 0,
            Y: 0,
          },
        ])));
        child.emit("close", 0);
      });
    };
    return child;
  };

  const windows = await queryWindowsApplicationWindows({
    processIds: [505, 505, -1],
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
  });

  assert.deepEqual(request, { processIds: [505] });
  assert.deepEqual(windows, [{
    windowId: 91,
    pid: 505,
    title: "",
    className: "ApplicationFrame",
    ownerWindowId: 0,
    visible: false,
    minimized: false,
    enabled: true,
    toolWindow: false,
    cloaked: false,
    bounds: { x: -32000, y: -32000, width: 960, height: 720 },
  }]);
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /EnumWindows/u);
  assert.match(probeSource, /GetWindowThreadProcessId/u);
  assert.match(probeSource, /WS_EX_TOOLWINDOW/u);
  assert.doesNotMatch(probeSource, /ShowWindow/u);
});

test("application window probe is inert outside Windows", async () => {
  assert.deepEqual(await queryWindowsApplicationWindows({
    processIds: [505],
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), []);
});
