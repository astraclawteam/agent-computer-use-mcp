import { readFile } from "node:fs/promises";

import { REGISTERED_ENVIRONMENT_ADAPTER_IDS } from "./environment-adapters/index.mjs";
import { validateQualificationTask } from "./qualification-contract.mjs";

const REQUIRED_FAMILIES = Object.freeze([
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
]);

export async function loadQualificationTaskPack(source) {
  const raw = typeof source === "string"
    ? JSON.parse(await readFile(source, "utf8"))
    : structuredClone(source);
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.requiredTaskFamilies)
    || !Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    throw packError("agent_e2e.task_pack_invalid");
  }
  const familyNames = Object.keys(raw.requiredTaskFamilies).sort();
  if (stableStringify(familyNames) !== stableStringify([...REQUIRED_FAMILIES].sort())) {
    throw packError("agent_e2e.task_pack_family_invalid");
  }
  const tasks = raw.tasks.map(validateQualificationTask);
  if (new Set(tasks.map((task) => task.taskId)).size !== tasks.length) {
    throw packError("agent_e2e.task_pack_duplicate_task");
  }
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const familyTaskIds = [];
  for (const family of REQUIRED_FAMILIES) {
    const ids = raw.requiredTaskFamilies[family];
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !taskIds.has(id))) {
      throw packError("agent_e2e.task_pack_family_invalid", family);
    }
    familyTaskIds.push(...ids);
  }
  if (new Set(familyTaskIds).size !== familyTaskIds.length) {
    throw packError("agent_e2e.task_pack_duplicate_family_mapping");
  }
  for (const task of tasks) {
    if (!REGISTERED_ENVIRONMENT_ADAPTER_IDS.includes(task.environmentAdapterId)) {
      throw packError("agent_e2e.task_pack_adapter_invalid", task.environmentAdapterId);
    }
  }
  return deepFreeze({
    schemaVersion: 1,
    requiredTaskFamilies: structuredClone(raw.requiredTaskFamilies),
    tasks,
  });
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function packError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
