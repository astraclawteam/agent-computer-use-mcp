import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  queryWindowsWindowRelationships,
} from "../src/windows-window-relationship-probe.mjs";

test("window relationship probe returns bounded owner and enabled state", async () => {
  let stdin = "";
  let spawnOptions;
  let encodedProbe;
  const spawnProcess = (_command, args, options) => {
    spawnOptions = options;
    encodedProbe = args.at(-1);
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin.write = (chunk) => {
      stdin += chunk;
    };
    child.stdin.end = (chunk = "") => {
      stdin += chunk;
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(JSON.stringify({
          relationships: [
            { windowId: "22", ownerWindowId: "11", enabled: true },
            { windowId: "11", ownerWindowId: null, enabled: false },
            { windowId: "99", ownerWindowId: null, enabled: true },
          ],
        })));
        child.emit("close", 0);
      });
    };
    return child;
  };

  assert.deepEqual(await queryWindowsWindowRelationships({
    windowIds: [11, "22", "22", "invalid"],
    platform: "win32",
    spawnProcess,
  }), [
    { windowId: "22", ownerWindowId: "11", enabled: true },
    { windowId: "11", ownerWindowId: null, enabled: false },
  ]);
  assert.deepEqual(JSON.parse(stdin), {
    windowIds: ["11", "22"],
    processIds: [],
    includeOwnedWindows: false,
  });
  assert.equal(spawnOptions.windowsHide, true);
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /GW_OWNER/u);
  assert.match(probeSource, /IsWindowEnabled/u);
});

test("window relationship probe admits only requested owned or same-process auxiliary windows", async () => {
  let stdin = "";
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    child.stdin.write = (chunk) => { stdin += chunk; };
    child.stdin.end = (chunk = "") => {
      stdin += chunk;
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(JSON.stringify({
          relationships: [
            {
              windowId: "11",
              ownerWindowId: null,
              enabled: true,
              visible: true,
              processId: 1234,
              title: "Main",
              ownedByRequestedWindow: false,
              sameRequestedProcess: true,
              bounds: { x: 10, y: 20, width: 900, height: 700 },
            },
            {
              windowId: "22",
              ownerWindowId: "11",
              enabled: true,
              visible: true,
              processId: 1234,
              title: "",
              ownedByRequestedWindow: true,
              sameRequestedProcess: true,
              bounds: { x: 40, y: 80, width: 360, height: 300 },
            },
            {
              windowId: "33",
              ownerWindowId: null,
              enabled: true,
              visible: true,
              processId: 1234,
              title: "Auxiliary",
              ownedByRequestedWindow: false,
              sameRequestedProcess: true,
              bounds: { x: 420, y: 80, width: 280, height: 240 },
            },
            {
              windowId: "44",
              ownerWindowId: null,
              enabled: true,
              visible: true,
              processId: 9999,
              title: "Foreign",
              ownedByRequestedWindow: false,
              sameRequestedProcess: false,
              bounds: { x: 0, y: 0, width: 100, height: 100 },
            },
          ],
        })));
        child.emit("close", 0);
      });
    };
    return child;
  };

  const relationships = await queryWindowsWindowRelationships({
    windowIds: [11],
    processIds: [1234],
    includeOwnedWindows: true,
    platform: "win32",
    spawnProcess,
  });

  assert.deepEqual(relationships.map(({ windowId }) => windowId), ["11", "22", "33"]);
  assert.equal(relationships[1].ownedByRequestedWindow, true);
  assert.equal(relationships[2].sameRequestedProcess, true);
  assert.deepEqual(JSON.parse(stdin), {
    windowIds: ["11"],
    processIds: [1234],
    includeOwnedWindows: true,
  });
});

test("window relationship probe is empty outside Windows", async () => {
  assert.deepEqual(await queryWindowsWindowRelationships({
    windowIds: [11],
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), []);
});
