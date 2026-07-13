import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";

import { runAppAdapter } from "../src/app-adapters/adapter-contract.mjs";
import { INSTALLED_APP_ADAPTER_FACTORIES } from "../src/app-adapters/index.mjs";
import { createLibreOfficeAdapter } from "../src/app-adapters/libreoffice.mjs";
import { createVscodeAdapter } from "../src/app-adapters/vscode.mjs";
import { createWpsOfficeAdapter } from "../src/app-adapters/wps-office.mjs";

const IDENTITY = {
  path: "C:/Program Files/App/app.exe",
  fileName: "app.exe",
  version: "1.0.0",
  sizeBytes: 10,
  sha256: "a".repeat(64),
};

test("VS Code uses isolated user and extension directories and verifies saved bytes", async () => {
  const harness = documentHarness("VS Code");
  const result = await runAppAdapter(createVscodeAdapter({
    ...harness.options,
    executable: IDENTITY,
    expectedText: "vscode fixture evidence\n",
  }), activeContext());

  assert.equal(result.status, "pass", result.reason);
  assert.equal(harness.args.some((arg) => arg.startsWith("--user-data-dir=")), true);
  assert.equal(harness.args.some((arg) => arg.startsWith("--extensions-dir=")), true);
  assert.equal(harness.args.includes("--disable-extensions"), true);
  assert.equal(harness.args.includes("--new-window"), true);
  assert.equal(harness.args.includes("--reuse-window"), false);
  assert.equal(harness.killed(), true);
});

for (const component of ["writer", "calc", "impress", "draw"]) {
  test(`LibreOffice ${component} uses an isolated profile and verifies temporary output`, async () => {
    const harness = documentHarness("LibreOffice");
    const result = await runAppAdapter(createLibreOfficeAdapter({
      ...harness.options,
      executable: IDENTITY,
      component,
      expectedText: `${component} fixture evidence`,
    }), activeContext());

    assert.equal(result.status, "pass", result.reason);
    assert.equal(harness.args.some((arg) => arg.startsWith("-env:UserInstallation=file:")), true);
    assert.equal(harness.args.includes("--norestore"), true);
    assert.equal(harness.args.includes("--nofirststartwizard"), true);
    assert.equal(harness.args.some((arg) => /recent/iu.test(arg)), false);
    assert.equal(harness.killed(), true);
  });
}

test("WPS opens only a generated temporary document and cleans up after UI failure", async () => {
  const harness = documentHarness("WPS", { failObservation: true });
  const result = await runAppAdapter(createWpsOfficeAdapter({
    ...harness.options,
    executable: IDENTITY,
    expectedText: "wps fixture evidence",
  }), activeContext());

  assert.equal(result.status, "product-failure");
  assert.equal(harness.args.some((arg) => arg === "/new"), true);
  assert.equal(harness.args.some((arg) => arg.endsWith("fixture.txt")), true);
  assert.equal(harness.args.some((arg) => /recent/iu.test(arg)), false);
  assert.equal(harness.killed(), true);
  assert.equal(harness.mcp.closed, true);
});

test("installed adapter factories use stable catalog names", () => {
  assert.deepEqual(Object.keys(INSTALLED_APP_ADAPTER_FACTORIES).sort(), [
    "libreoffice-calc",
    "libreoffice-draw",
    "libreoffice-impress",
    "libreoffice-writer",
    "vscode-workspace",
    "wps-document",
  ]);
});

function documentHarness(title, options = {}) {
  let launchedArgs = [];
  let filePath;
  let killed = false;
  let menuOpen = false;
  let expectedFixtureText;
  const mcp = {
    closed: false,
    async start() {},
    async close() { this.closed = true; },
    async callTool(name, args) {
      if (name === "list_windows") return structured({ windows: [{ pid: 505, window_id: "window-505", title, bounds: { x: 0, y: 0, width: 900, height: 700 } }] });
      if (name === "get_window_state") {
        if (options.failObservation) throw codedError("app.first_run_dialog_blocked");
        return structured({ elements: menuOpen
          ? [element(3, "MenuItem", "Save")]
          : [element(1, "Edit", "Document", ["set_value"]), element(2, "MenuItem", "File")] });
      }
      if (name === "click" && args.element_index === 2) menuOpen = true;
      if (name === "click" && args.element_index === 3) await writeFile(filePath, expectedFixtureText, "utf8");
      return structured({ ok: true });
    },
  };
  return {
    mcp,
    get args() { return launchedArgs; },
    killed: () => killed,
    options: {
      mcp,
      sleep: async () => {},
      spawnApp(_path, args) {
        launchedArgs = args;
        filePath = args.find((arg) => arg.endsWith("fixture.txt"));
        return { pid: 505, kill() { killed = true; } };
      },
      onFixture(preparedPath, expectedText) {
        filePath = preparedPath;
        expectedFixtureText = expectedText;
      },
    },
  };
}

function element(index, role, label, actions = ["click"]) {
  return { element_index: index, element_token: `token-${index}`, role, label, actions };
}

function structured(value) { return { structuredContent: value }; }
function activeContext() { return { controlLease: { id: "installed-app", status: "active" } }; }
function codedError(code) { const error = new Error(code); error.code = code; return error; }
