import assert from "node:assert/strict";
import test from "node:test";

import { loadQualificationTaskPack } from "../src/agent-e2e/task-pack.mjs";
import { REGISTERED_ENVIRONMENT_ADAPTER_IDS } from "../src/agent-e2e/environment-adapters/index.mjs";

const REQUIRED_FAMILIES = [
  "text-editing",
  "spreadsheet",
  "presentation",
  "browser-form-download",
  "electron-editor",
  "system-dialog-file-chooser",
  "self-drawn-canvas",
  "multi-window",
  "intermediate-state-recovery",
  "control-and-policy",
];

test("task pack covers every approved Agent E2E family", async () => {
  const pack = await loadQualificationTaskPack("docs/productization/agent-e2e-task-pack.json");
  assert.deepEqual(Object.keys(pack.requiredTaskFamilies).sort(), [...REQUIRED_FAMILIES].sort());
  assert.equal(pack.tasks.length >= REQUIRED_FAMILIES.length, true);
  for (const [family, taskIds] of Object.entries(pack.requiredTaskFamilies)) {
    assert.equal(taskIds.length > 0, true, family);
    assert.equal(taskIds.every((taskId) => pack.tasks.some((task) => task.taskId === taskId)), true, family);
  }
});

test("every task uses a registered environment-only adapter and canonical prompt hash", async () => {
  const pack = await loadQualificationTaskPack("docs/productization/agent-e2e-task-pack.json");
  for (const task of pack.tasks) {
    assert.equal(REGISTERED_ENVIRONMENT_ADAPTER_IDS.includes(task.environmentAdapterId), true, task.taskId);
    assert.match(task.promptSha256, /^[a-f0-9]{64}$/u);
    assert.equal(task.scope.temporaryWorkspaceOnly, true);
    assert.equal(task.privacyPolicy.syntheticDataOnly, true);
    assert.equal(task.privacyPolicy.sealScreenshots, false);
    assert.equal(task.privacyPolicy.sealRawOcr, false);
  }
});

test("task pack has no host variants or embedded action guidance", async () => {
  const pack = await loadQualificationTaskPack("docs/productization/agent-e2e-task-pack.json");
  const source = JSON.stringify(pack);
  assert.doesNotMatch(source, /hostPrompt|promptByLane|coordinates|elementName|menuPath|dialogInstructions|actionSequence|toolSequence/iu);
  assert.equal(new Set(pack.tasks.map((task) => task.taskId)).size, pack.tasks.length);
});

test("task pack rejects an easier duplicate family mapping", async () => {
  await assert.rejects(
    loadQualificationTaskPack({
      schemaVersion: 1,
      requiredTaskFamilies: Object.fromEntries(REQUIRED_FAMILIES.map((family) => [family, ["same-task"]])),
      tasks: [],
    }),
    /agent_e2e\.task_pack_invalid/u,
  );
});
