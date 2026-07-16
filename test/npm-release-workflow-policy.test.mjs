import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

import {
  createVerifiedSnapshot,
  createNpmReleaseOperations,
  hardenWindowsSnapshotDirectory,
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
  assert.doesNotMatch(source, /--publish\b/iu);
  assert.doesNotMatch(source, /\bgit\b[^\r\n]*\bpush\b/iu);
  assert.doesNotMatch(source, /\bgh\s+(?:api|release)\b/iu);
  assert.doesNotMatch(source, /gitee/iu);

  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) {
    assert.notEqual(job.permissions, "write-all");
    assert.notEqual(job.permissions?.contents, "write");
    assert.notEqual(job.permissions?.["id-token"], "write");
  }

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
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async () => "verified-sha512",
    sha512: async () => "verified-sha512",
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
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

test("manual package release rejects renamed stale and content-drifted tarballs", async () => {
  const operations = {
    inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.2.3" }),
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async () => "expected-sha512",
    sha512: async () => "expected-sha512",
    snapshot: async () => { throw new Error("release.artifact_mismatch"); },
    registryVersion: async () => null,
    publish: async () => assert.fail("publish must remain unreachable"),
  };

  await assert.rejects(
    () => runNpmPackageRelease(["--package", "renamed.tgz", "--publish"], operations),
    /release\.package_filename_mismatch/u,
  );
  await assert.rejects(
    () => runNpmPackageRelease(
      ["--package", "agent-computer-use-mcp-1.1.0.tgz", "--publish"],
      { ...operations, inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.1.0" }) },
    ),
    /release\.source_version_mismatch/u,
  );
  await assert.rejects(
    () => runNpmPackageRelease(
      ["--package", "agent-computer-use-mcp-1.2.3.tgz", "--publish"],
      operations,
    ),
    /release\.artifact_mismatch/u,
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
  operations.sourceVersion = async () => "1.2.3";
  operations.sourceArtifactSha512 = async () => "verified-sha512";
  operations.sha512 = async () => "verified-sha512";
  const snapshotPath = resolve("private-snapshot", "agent-computer-use-mcp-1.2.3.tgz");
  operations.snapshot = async () => ({ path: snapshotPath, cleanup: async () => {} });

  const report = await runNpmPackageRelease(
    ["--package", "agent-computer-use-mcp-1.2.3.tgz", "--publish"],
    operations,
  );

  assert.equal(report.status, "published");
  assert.deepEqual(calls, [
    ["pack", resolve("agent-computer-use-mcp-1.2.3.tgz"), "--dry-run", "--json"],
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
      snapshotPath,
      "--access",
      "public",
      "--ignore-scripts",
      "--registry",
      "https://registry.npmjs.org/",
    ],
  ]);
});

test("registry lookup cannot swap the bytes selected for publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-toctou-"));
  const packagePath = join(root, "agent-computer-use-mcp-1.2.3.tgz");
  const verifiedBytes = Buffer.from("verified-tarball-bytes");
  const replacementBytes = Buffer.from("replacement-tarball-bytes");
  const expectedSha512 = createHash("sha512").update(verifiedBytes).digest("hex");
  let publishedPath;
  let publishedBytes;
  try {
    await writeFile(packagePath, verifiedBytes);
    const operations = createNpmReleaseOperations(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ name: "agent-computer-use-mcp", version: "1.2.3" }]),
      stderr: "",
    }));
    operations.sourceVersion = async () => "1.2.3";
    operations.sourceArtifactSha512 = async () => expectedSha512;
    operations.registryVersion = async () => {
      await writeFile(packagePath, replacementBytes);
      return null;
    };
    operations.publish = async (selectedPath) => {
      publishedPath = selectedPath;
      publishedBytes = await readFile(selectedPath);
    };

    assert.equal((await runNpmPackageRelease(["--package", packagePath, "--publish"], operations)).status, "published");
    assert.notEqual(publishedPath, packagePath);
    assert.deepEqual(publishedBytes, verifiedBytes);
    await assert.rejects(() => readFile(publishedPath), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows ACL hardening failure stops before registry lookup and publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-acl-failure-"));
  const packagePath = join(root, "agent-computer-use-mcp-1.2.3.tgz");
  const bytes = Buffer.from("verified-tarball-bytes");
  const expectedSha512 = createHash("sha512").update(bytes).digest("hex");
  let registryCalled = false;
  let publishCalled = false;
  try {
    await writeFile(packagePath, bytes);
    const operations = {
      inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.2.3" }),
      sourceVersion: async () => "1.2.3",
      sourceArtifactSha512: async () => expectedSha512,
      sha512: async () => expectedSha512,
      snapshot: (...args) => createVerifiedSnapshot(...args, {
        platform: "win32",
        hardenDirectory: async () => { throw new Error("release.snapshot_acl_failed"); },
      }),
      registryVersion: async () => { registryCalled = true; return null; },
      publish: async () => { publishCalled = true; },
    };

    await assert.rejects(
      () => runNpmPackageRelease(["--package", packagePath, "--publish"], operations),
      /release\.snapshot_acl_failed/u,
    );
    assert.equal(registryCalled, false);
    assert.equal(publishCalled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows snapshot ACL grants write only to owner SYSTEM and Administrators", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-acl-real-"));
  try {
    const report = await hardenWindowsSnapshotDirectory(root);
    assert.deepEqual(new Set(report.entries.map(({ principal }) => principal.toLowerCase())), new Set([
      report.accountName.toLowerCase(),
      "nt authority\\system",
      "builtin\\administrators",
    ]));
    assert.equal(report.entries.every(({ permissions }) => permissions.includes("(F)")), true);
    assert.equal(report.entries.every(({ permissions }) => !permissions.includes("(I)")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow build and protected pack entrypoints cannot mutate release channels", async () => {
  const sources = await Promise.all([
    readFile("scripts/build-platform-release.mjs", "utf8"),
    readFile("scripts/pack-protected-npm-package.mjs", "utf8"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /\bnpm\s+(?:publish|unpublish|deprecate|dist-tag|owner|access|token)\b/iu);
    assert.doesNotMatch(source, /--publish\b|\bgit\b[\s\S]*?\bpush\b/iu);
    assert.doesNotMatch(source, /\bgh\s+(?:api|release)\b|gitee/iu);
  }
});
