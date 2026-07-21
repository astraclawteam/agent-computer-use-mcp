import assert from "node:assert/strict";
import { test } from "node:test";

import { getInstallLayout } from "../src/package-foundation.mjs";

test("package foundation limits writable state to disposable user data", () => {
  const layout = getInstallLayout({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" } });
  assert.equal(layout.dataRoot, "C:\\Users\\demo\\AppData\\Local\\AgentComputerUse");
  assert.equal(layout.cacheRoot, `${layout.dataRoot}\\cache`);
  assert.equal(layout.sessionRoot, `${layout.dataRoot}\\sessions`);
  assert.equal(layout.authoritativeProgramState, false);
});
