import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import {
  createNpmReleaseOperations,
  runNpmPackageRelease,
} from "../scripts/release-npm-package.mjs";

test("source workspace stays private and CI only uploads packed npm tarballs", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const source = await readFile(".github/workflows/release.yml", "utf8");
  const workflow = parse(source);

  assert.equal(packageJson.private, true);
  assert.equal(
    packageJson.scripts["release:npm:package"],
    "node scripts/release-npm-package.mjs",
  );
  assert.deepEqual(Object.keys(workflow.jobs), ["validate", "build-npm-artifacts"]);
  assert.doesNotMatch(
    source,
    /\bnpm\s+(?:publish|unpublish|deprecate|dist-tag|owner|access|token)\b/iu,
  );
  assert.doesNotMatch(source, /NODE_AUTH_TOKEN|NPM_(?:CORE|PLATFORM_)?TOKEN/iu);

  const upload = workflow.jobs["build-npm-artifacts"].steps.find(
    ({ uses }) => uses === "actions/upload-artifact@v4",
  );
  assert.equal(upload.with.name, "npm-release-tarballs");
  assert.match(upload.with.path, /\/\*\.tgz$/u);
  assert.doesNotMatch(upload.with.path, /\.zip|\.exe|\.json/iu);
});

test("manual package release is preview-only unless --publish is explicit", async () => {
  const calls = [];
  const operations = {
    inspect: async (tarballPath) => {
      calls.push(["inspect", tarballPath]);
      return { name: "agent-computer-use-mcp", version: "1.2.3" };
    },
    registryVersion: async (name, version) => {
      calls.push(["registryVersion", name, version]);
      return null;
    },
    publish: async (tarballPath) => {
      calls.push(["publish", tarballPath]);
    },
  };

  const preview = await runNpmPackageRelease(
    ["--package", "artifacts/release/agent-computer-use-mcp-1.2.3.tgz"],
    operations,
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.publishRequested, false);
  assert.equal(calls.some(([operation]) => operation === "publish"), false);

  const published = await runNpmPackageRelease(
    ["--package", "artifacts/release/agent-computer-use-mcp-1.2.3.tgz", "--publish"],
    operations,
  );
  assert.equal(published.status, "published");
  assert.equal(published.publishRequested, true);
  assert.equal(calls.filter(([operation]) => operation === "publish").length, 1);
});

test("manual package release rejects implicit or ambiguous input", async () => {
  await assert.rejects(() => runNpmPackageRelease([]), /release\.package_required/u);
  await assert.rejects(
    () => runNpmPackageRelease(["--package", "one.tgz", "--package", "two.tgz"]),
    /release\.package_repeated/u,
  );
  await assert.rejects(
    () => runNpmPackageRelease(["--package", "one.tgz", "--force"]),
    /release\.argument_unknown/u,
  );
});

test("tarball inspection is local and separate from the registry lookup", async () => {
  const calls = [];
  const operations = createNpmReleaseOperations(async (args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stdout: JSON.stringify([{ name: "agent-computer-use-mcp", version: "1.2.3" }]),
      stderr: "",
    };
  });

  assert.deepEqual(await operations.inspect("candidate.tgz"), {
    name: "agent-computer-use-mcp",
    version: "1.2.3",
  });
  assert.deepEqual(calls[0], ["pack", "candidate.tgz", "--dry-run", "--json"]);
});

test("explicit publication sends exactly one tarball to the public registry", async () => {
  const calls = [];
  const operations = createNpmReleaseOperations(async (args) => {
    calls.push(args);
    if (args[0] === "pack") {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ name: "agent-computer-use-mcp", version: "1.2.3" }]),
        stderr: "",
      };
    }
    if (args[0] === "view") {
      return { exitCode: 1, stdout: "", stderr: "npm error code E404" };
    }
    return { exitCode: 0, stdout: "published", stderr: "" };
  });

  const report = await runNpmPackageRelease(
    ["--package", "candidate.tgz", "--publish"],
    operations,
  );

  assert.equal(report.status, "published");
  assert.deepEqual(calls, [
    ["pack", resolve("candidate.tgz"), "--dry-run", "--json"],
    [
      "view",
      "agent-computer-use-mcp@1.2.3",
      "version",
      "--json",
      "--registry",
      "https://registry.npmjs.org/",
    ],
    [
      "publish",
      resolve("candidate.tgz"),
      "--access",
      "public",
      "--ignore-scripts",
      "--registry",
      "https://registry.npmjs.org/",
    ],
  ]);
});
