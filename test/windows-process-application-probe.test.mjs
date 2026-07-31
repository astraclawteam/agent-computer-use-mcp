import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { queryWindowsProcessApplications } from "../src/windows-process-application-probe.mjs";

test("Windows process application probe returns validated opaque-token sources", async () => {
  let encodedProbe;
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
    spawnProcess(command, args) {
      encodedProbe = args.at(-1);
      return spawnProcess(command, args);
    },
  }), [{
    name: "Tray App",
    kind: "desktop",
    running: true,
    active: false,
    pid: 505,
    processIds: [505, 506],
    lastUsed: null,
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
  }]);
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /OutputEncoding/u);
  assert.match(probeSource, /GetFolderPath\('StartMenu'\)/u);
  assert.match(probeSource, /GetFolderPath\('CommonStartMenu'\)/u);
  assert.match(probeSource, /\$shortcutTarget/u);
  assert.doesNotMatch(probeSource, /Weixin|微信/u);
});

test("Windows process application probe is empty on unsupported platforms", async () => {
  assert.deepEqual(await queryWindowsProcessApplications({
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), []);
});
