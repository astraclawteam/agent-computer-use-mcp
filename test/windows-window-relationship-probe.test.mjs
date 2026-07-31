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
  assert.deepEqual(JSON.parse(stdin), { windowIds: ["11", "22"] });
  assert.equal(spawnOptions.windowsHide, true);
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /GW_OWNER/u);
  assert.match(probeSource, /IsWindowEnabled/u);
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
