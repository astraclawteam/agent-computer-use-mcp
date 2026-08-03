import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { clickWindowsRelatedSurface } from "../src/windows-related-surface-click.mjs";

test("related-surface click binds a foreground controller to one visible owned HWND", async () => {
  let stdin = "";
  let script = "";
  const spawnProcess = (_path, args) => {
    script = Buffer.from(args.at(-1), "base64").toString("utf16le");
    const child = fakeChild();
    child.stdin.end = (chunk) => {
      stdin += chunk;
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from(JSON.stringify({
          status: "ok",
          effect: "verified",
          verified: true,
          postcondition: "related-surface-dismissed",
          deliveryPath: "windows-related-surface-click",
        })));
        child.emit("close", 0);
      });
    };
    return child;
  };

  const result = await clickWindowsRelatedSurface({
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
    controllerWindowId: "42",
    relatedWindowId: "77",
    processId: 1234,
    screenX: 584,
    screenY: 235,
  });

  assert.deepEqual(JSON.parse(stdin), {
    controllerWindowId: "42",
    relatedWindowId: "77",
    processId: 1234,
    screenX: 584,
    screenY: 235,
  });
  assert.match(script, /foreground != controller && foreground != surface/u);
  assert.match(script, /GetWindow\(surface, GW_OWNER\)/u);
  assert.match(script, /GetWindowThreadProcessId\(surface/u);
  assert.match(script, /GetAncestor\(hit, GA_ROOT\) != surface/u);
  assert.match(script, /SetCursorPos\(x, y\)[\s\S]*Thread\.Sleep\(POINTER_SETTLE_MS\)/u);
  assert.match(script, /mouse_event\(MOUSEEVENTF_LEFTDOWN[\s\S]*CLICK_TRANSITION_MS[\s\S]*MOUSEEVENTF_LEFTUP/u);
  assert.match(script, /!IsWindow\(surface\) \|\| !IsWindowVisible\(surface\)/u);
  assert.match(script, /related-surface-dismissed/u);
  assert.deepEqual(result, {
    status: "ok",
    effect: "verified",
    verified: true,
    postcondition: "related-surface-dismissed",
    deliveryPath: "windows-related-surface-click",
  });
});

test("related-surface click reports the exact bridge validation stage", async () => {
  const spawnProcess = () => {
    const child = fakeChild();
    child.stdin.end = () => {
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("controlled_surface_not_foreground"));
        child.emit("close", 1);
      });
    };
    return child;
  };

  await assert.rejects(clickWindowsRelatedSurface({
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
    controllerWindowId: "42",
    relatedWindowId: "77",
    processId: 1234,
    screenX: 584,
    screenY: 235,
  }), (error) => error?.code === "related_click.controlled_surface_not_foreground");
});

test("related-surface click cancels an in-flight bridge", async () => {
  let killed = false;
  const spawnProcess = () => {
    const child = fakeChild();
    child.stdin.end = () => {};
    child.kill = () => { killed = true; };
    return child;
  };
  const controller = new AbortController();
  const action = clickWindowsRelatedSurface({
    platform: "win32",
    powershellPath: "powershell.exe",
    spawnProcess,
    controllerWindowId: "42",
    relatedWindowId: "77",
    processId: 1234,
    screenX: 584,
    screenY: 235,
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(action, (error) => error?.code === "related_click.cancelled");
  assert.equal(killed, true);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
}
