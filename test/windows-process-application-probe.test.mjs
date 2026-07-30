import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { queryWindowsProcessApplications } from "../src/windows-process-application-probe.mjs";

test("Windows process application probe returns validated opaque-token sources", async () => {
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(JSON.stringify([
        {
          name: "Tray App",
          pid: 505,
          launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
        },
        {
          name: "Duplicate",
          pid: 506,
          launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
        },
        {
          name: "Invalid",
          pid: 0,
          launchPath: "not-an-executable",
        },
      ])));
      child.emit("close", 0);
    });
    return child;
  };

  assert.deepEqual(await queryWindowsProcessApplications({
    platform: "win32",
    spawnProcess,
  }), [{
    name: "Tray App",
    kind: "desktop",
    running: true,
    active: false,
    pid: 505,
    lastUsed: null,
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
  }]);
});

test("Windows process application probe is empty on unsupported platforms", async () => {
  assert.deepEqual(await queryWindowsProcessApplications({
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), []);
});
