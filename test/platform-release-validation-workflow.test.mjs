import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse } from "yaml";

test("platform release validation runs the networked production assembly without publishing", async () => {
  const source = await readFile(
    ".github/workflows/platform-release-validation.yml",
    "utf8",
  );
  const workflow = parse(source);
  assert.deepEqual(Object.keys(workflow.jobs), ["build-windows-x64"]);
  const job = workflow.jobs["build-windows-x64"];
  const runs = job.steps.map((step) => step.run ?? "").join("\n");
  const checkout = job.steps.find(({ uses }) => uses?.startsWith("actions/checkout@"));
  const upload = job.steps.find(({ uses }) => uses?.startsWith("actions/upload-artifact@"));
  const build = job.steps.find(({ name }) => name === "Assemble production platform release");
  const size = job.steps.find(({ name }) => name === "Report production artifact sizes");
  const actionUses = job.steps.flatMap(({ uses }) => uses ? [uses] : []);

  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.equal(job["runs-on"], "windows-2025");
  assert.deepEqual(
    build.run.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
    [
      "New-Item -ItemType Directory -Force artifacts/platform-validation | Out-Null",
      "node scripts/build-platform-release.mjs --allow-network |",
      "Tee-Object -FilePath artifacts/platform-validation/build-report.json",
    ],
  );
  assert.match(runs, /node scripts\/windows-release-size-report\.mjs/u);
  assert.deepEqual(actionUses, [
    "actions/checkout@v4",
    "actions/setup-node@v4",
    "actions/setup-dotnet@v4",
    "actions/upload-artifact@v4",
  ]);
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(size.id, "release-size");
  assert.match(size.run, /offline_bytes=[\s\S]*GITHUB_OUTPUT/u);
  assert.equal(upload.if, "always()");
  assert.equal(
    upload.with.name,
    "platform-release-validation-${{ steps.release-size.outputs.offline_bytes }}-bytes",
  );
  assert.match(upload.with.path, /artifacts\/platform-release(?:\r?\n|$)/u);
  assert.match(upload.with.path, /artifacts\/platform-validation(?:\r?\n|$)/u);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.doesNotMatch(runs, /(?:npm|pnpm|yarn)\s+publish|gh\s+release|gitee/iu);
  assert.doesNotMatch(source, /secrets\s*(?:\.|\[)/iu);
});
