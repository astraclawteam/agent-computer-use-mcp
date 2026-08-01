import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";

import { verifyWindowsFocusedProcess } from "../src/windows-focus-verification.mjs";

test("verifyWindowsFocusedProcess uses a read-only native focus probe", async () => {
  const calls = [];
  let payload = null;
  const result = await verifyWindowsFocusedProcess({
    windowId: 42,
    processId: 1234,
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return fakeChild((stdin, child) => {
        payload = JSON.parse(stdin);
        child.stdout.end(JSON.stringify({
          status: "ok",
          focusVerified: true,
          verificationPath: "windows_user32_foreground_focus",
        }));
        child.emit("close", 0, null);
      });
    },
  });

  assert.deepEqual(payload, { windowId: "42", processId: 1234 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const bridgeScript = Buffer.from(calls[0].args.at(-1), "base64").toString("utf16le");
  assert.doesNotMatch(bridgeScript, /Clipboard|SendInput|keybd_event|WM_CHAR/u);
  assert.deepEqual(result, {
    status: "ok",
    focusVerified: true,
    verificationPath: "windows_user32_foreground_focus",
  });
});

test("verifyWindowsFocusedProcess rejects invalid targets without starting a bridge", async () => {
  let spawnCount = 0;
  const spawnProcess = () => {
    spawnCount += 1;
    throw new Error("must not spawn");
  };

  await assert.rejects(
    () => verifyWindowsFocusedProcess({
      windowId: 42,
      processId: 1234,
      platform: "linux",
      spawnProcess,
    }),
    { code: "focus_verification.unsupported_platform" },
  );
  await assert.rejects(
    () => verifyWindowsFocusedProcess({
      windowId: 0,
      processId: 1234,
      platform: "win32",
      spawnProcess,
    }),
    { code: "focus_verification.invalid_window" },
  );
  assert.equal(spawnCount, 0);
});

test("verifyWindowsFocusedProcess classifies a synchronous bridge start failure", async () => {
  await assert.rejects(
    () => verifyWindowsFocusedProcess({
      windowId: 42,
      processId: 1234,
      platform: "win32",
      spawnProcess() {
        throw new Error("private process detail");
      },
    }),
    (error) => {
      assert.equal(error.code, "focus_verification.bridge_unavailable");
      assert.equal(error.detail.stage, "bridge-start");
      assert.equal(error.detail.effect, "not-applied");
      assert.doesNotMatch(error.message, /private process detail/u);
      return true;
    },
  );
});

function fakeChild(onStdin) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let stdinText = "";
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinText += chunk.toString();
      callback();
    },
    final(callback) {
      queueMicrotask(() => onStdin(stdinText, child));
      callback();
    },
  });
  child.kill = () => {};
  return child;
}
