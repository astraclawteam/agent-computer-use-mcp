import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { sendWindowsUnicodeText } from "../src/windows-unicode-input.mjs";

test("sendWindowsUnicodeText keeps text off process arguments and delivers it through stdin", async () => {
  const spawnCalls = [];
  let stdinText = "";
  const spawnProcess = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return fakeChild({
      onStdin(value, child) {
        stdinText = value;
        child.stdout.end('{"status":"ok","utf16CodeUnits":2,"clipboardRestored":true,"changeSignalDelivered":true,"deliveryPath":"windows_sendinput_unicode_incremental"}');
        child.emit("close", 0, null);
      },
    });
  };

  const result = await sendWindowsUnicodeText({
    windowId: 42,
    processId: 1234,
    text: "宋鹏",
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
  });

  assert.deepEqual(result, {
    status: "ok",
    utf16CodeUnits: 2,
    clipboardRestored: true,
    changeSignalDelivered: true,
    deliveryPath: "windows_sendinput_unicode_incremental",
  });
  const payload = JSON.parse(stdinText);
  assert.deepEqual(payload, {
    windowId: "42",
    processId: 1234,
    textBase64: Buffer.from("宋鹏", "utf8").toString("base64"),
    replaceAll: false,
    inputBehavior: "incremental",
  });
  assert.equal(Buffer.from(payload.textBase64, "base64").toString("utf8"), "宋鹏");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, "powershell.exe");
  assert.equal(spawnCalls[0].args.some((value) => value.includes("宋鹏")), false);
  assert.equal(spawnCalls[0].args.includes("-Sta"), true);
  assert.ok(spawnCalls[0].args.at(-1).length < 30_000, "encoded bridge must stay below Windows command-line limits");
  const bridgeScript = Buffer.from(spawnCalls[0].args.at(-1), "base64").toString("utf16le");
  assert.equal(bridgeScript.split("[AgentComputerUseIncrementalInput]::Send(").length - 1, 1);
  assert.match(bridgeScript, /SendInput\(/);
  assert.match(bridgeScript, /private const uint KEYEVENTF_UNICODE = 0x0004;/);
  assert.match(bridgeScript, /SendChord\(0x11, 0x41\);[\s\S]*SendKey\(0x08\);[\s\S]*foreach \(char codeUnit in text\)/);
  assert.match(bridgeScript, /SendKey\(0x20\);[\s\S]*SendKey\(0x08\);/);
  assert.equal(JSON.stringify(spawnCalls[0].options).includes("宋鹏"), false);
  assert.equal(spawnCalls[0].options.windowsHide, true);
  assert.deepEqual(spawnCalls[0].options.stdio, ["pipe", "pipe", "pipe"]);
});

test("sendWindowsUnicodeText sends replace-all intent through the private stdin payload", async () => {
  let stdinText = "";
  const spawnProcess = () => fakeChild({
    onStdin(value, child) {
      stdinText = value;
      child.stdout.end('{"status":"ok","utf16CodeUnits":2,"clipboardRestored":true,"changeSignalDelivered":true,"deliveryPath":"windows_clipboard_transaction"}');
      child.emit("close", 0, null);
    },
  });

  await sendWindowsUnicodeText({
    windowId: 42,
    processId: 1234,
    text: "宋鹏",
    replaceAll: true,
    inputBehavior: "commit",
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
  });

  const payload = JSON.parse(stdinText);
  assert.equal(payload.replaceAll, true);
  assert.equal(payload.inputBehavior, "commit");
  assert.equal(Buffer.from(payload.textBase64, "base64").toString("utf8"), "宋鹏");
});

test("sendWindowsUnicodeText redacts text from bridge failures", async () => {
  const spawnProcess = () => fakeChild({
    onStdin(_value, child) {
      child.stderr.end("failed while handling 宋鹏");
      child.emit("close", 1, null);
    },
  });

  await assert.rejects(
    () => sendWindowsUnicodeText({
      windowId: 42,
      processId: 1234,
      text: "宋鹏",
      platform: "win32",
      powershellPath: "powershell.exe",
      spawnProcess,
    }),
    (error) => {
      assert.equal(error.code, "unicode_input.bridge_failed");
      assert.doesNotMatch(error.message, /宋鹏/);
      return true;
    },
  );
});

test("sendWindowsUnicodeText rejects unsupported platforms and oversized payloads before spawning", async () => {
  let spawnCount = 0;
  const spawnProcess = () => {
    spawnCount += 1;
    throw new Error("must not spawn");
  };

  await assert.rejects(
    () => sendWindowsUnicodeText({
      windowId: 42,
      processId: 1234,
      text: "中文",
      platform: "linux",
      spawnProcess,
    }),
    { code: "unicode_input.unsupported_platform" },
  );
  await assert.rejects(
    () => sendWindowsUnicodeText({
      windowId: 42,
      processId: 1234,
      text: "界".repeat(32_769),
      platform: "win32",
      spawnProcess,
    }),
    { code: "unicode_input.payload_too_large" },
  );
  await assert.rejects(
    () => sendWindowsUnicodeText({
      windowId: 42,
      processId: 0,
      text: "",
      platform: "win32",
      spawnProcess,
    }),
    { code: "unicode_input.invalid_process" },
  );
  await assert.rejects(
    () => sendWindowsUnicodeText({
      windowId: 42,
      processId: 1234,
      text: "",
      inputBehavior: "application-specific",
      platform: "win32",
      spawnProcess,
    }),
    { code: "unicode_input.invalid_behavior" },
  );
  assert.equal(spawnCount, 0);
});

function fakeChild({ onStdin }) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
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
  let stdinText = "";
  return child;
}
