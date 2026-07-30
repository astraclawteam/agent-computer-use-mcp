import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { activateWindowsTrayApplication } from "../src/windows-tray-application-activation.mjs";

test("tray activation passes the exact application identity through a bounded hidden probe", async () => {
  let spawnOptions;
  let encodedProbe;
  const spawnProcess = (_command, args, options) => {
    spawnOptions = options;
    encodedProbe = args.at(-1);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from('{"status":"invoked"}'));
      child.emit("close", 0);
    });
    return child;
  };

  assert.deepEqual(await activateWindowsTrayApplication({
    name: "  Tray App  ",
    platform: "win32",
    spawnProcess,
  }), { status: "invoked" });
  assert.equal(spawnOptions.windowsHide, true);
  assert.equal(spawnOptions.env.AGENT_COMPUTER_USE_TRAY_IDENTITY, "Tray App");
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /AndCondition/u);
  assert.match(probeSource, /NotifyItemIcon/u);
});

test("tray activation is unavailable outside Windows", async () => {
  assert.deepEqual(await activateWindowsTrayApplication({
    name: "Tray App",
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), { status: "unavailable" });
});
