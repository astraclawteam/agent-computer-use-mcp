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
          ownerPid: 404,
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
    ownerProcessIds: [404],
    lastUsed: null,
    launchPath: "C:\\Program Files\\Tray App\\tray-app.exe",
  }]);
  const probeSource = Buffer.from(encodedProbe, "base64").toString("utf16le");
  assert.match(probeSource, /OutputEncoding/u);
  assert.match(probeSource, /GetFolderPath\('StartMenu'\)/u);
  assert.match(probeSource, /GetFolderPath\('CommonStartMenu'\)/u);
  assert.match(probeSource, /\$shortcutTarget/u);
  assert.match(probeSource, /Test-SameApplicationFamily/u);
  assert.match(probeSource, /ownerPid/u);
  assert.match(probeSource, /\$windowHandleByPid/u);
  assert.match(probeSource, /MainWindowHandle -ne 0/u);
  assert.doesNotMatch(
    probeSource,
    /MainWindowHandle -ne 0 -and -not \[string\]::IsNullOrWhiteSpace\(\$_\.MainWindowTitle\)/u,
    "an empty title must not erase the independent HWND fact",
  );
  assert.doesNotMatch(probeSource, /Weixin|微信/u);
});

test("Windows process application probe admits windowed applications under the Windows directory", async () => {
  let probeSource;
  await queryWindowsProcessApplications({
    platform: "win32",
    spawnProcess(command, args) {
      probeSource = Buffer.from(args.at(-1), "base64").toString("utf16le");
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("[]"));
        child.emit("close", 0);
      });
      return child;
    },
  });

  // Packaged apps run inside a generic host under the Windows directory, so
  // excluding that directory outright makes every one of them unreachable by
  // name. Owning a visible top-level window is what admits them.
  assert.match(probeSource, /\$windowHandleByPid/u);
  assert.match(probeSource, /MainWindowHandle -ne 0/u);
  assert.match(
    probeSource,
    /\$fullPath\.StartsWith\(\$windowsRoot, \[System\.StringComparison\]::OrdinalIgnoreCase\) -and -not \$hasWindow/u,
    "the Windows-directory exclusion must not drop a windowed application",
  );
  // A shared host executable has no Start Menu shortcut of its own, so the
  // window title carries the name the user would actually say.
  assert.match(probeSource, /elseif \(-not \[string\]::IsNullOrWhiteSpace\(\$windowTitle\) -and \$fullPath\.StartsWith\(\$windowsRoot/u);
  // The Start Menu name still wins where one exists, so stable identities are
  // preferred over titles that change with content.
  assert.match(probeSource, /if \(\$shortcutNames\.ContainsKey\(\$fullPath\)\)/u);
  assert.doesNotMatch(probeSource, /ApplicationFrameHost|SystemSettings/u, "no application-specific rules");
});

test("Windows process application probe is empty on unsupported platforms", async () => {
  assert.deepEqual(await queryWindowsProcessApplications({
    platform: "linux",
    spawnProcess() {
      throw new Error("must not spawn");
    },
  }), []);
});
