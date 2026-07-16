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
  createReleaseSourceSnapshot,
  hardenWindowsSnapshotDirectory,
  runNpmPackageRelease,
  verifyReleaseSourceIdentity,
} from "../scripts/release-npm-package.mjs";

const TEST_SHA512 = createHash("sha512").update("verified-tarball").digest("hex");
const TEST_INTEGRITY = `sha512-${Buffer.from(TEST_SHA512, "hex").toString("base64")}`;

function withReleaseSource(operations, version = "1.2.3") {
  const identity = { version, tag: `v${version}`, commit: "a".repeat(40) };
  return {
    sourceIdentity: async () => identity,
    sourceVersion: async () => version,
    verifySourceIdentity: async () => {},
    waitForRegistry: async () => {},
    ...operations,
  };
}

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

test("release source identity rejects a feature commit after read-only remote refresh", async () => {
  const authoritativeCommit = "a".repeat(40);
  const featureCommit = "b".repeat(40);
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    const key = args.join(" ");
    if (key === "fetch --quiet origin main --tags") return { exitCode: 0, stdout: "", stderr: "" };
    if (key === "status --porcelain --untracked-files=normal") return { exitCode: 0, stdout: "", stderr: "" };
    if (key === "rev-parse HEAD") return { exitCode: 0, stdout: `${featureCommit}\n`, stderr: "" };
    if (key === "rev-list -n 1 v1.2.3") return { exitCode: 0, stdout: `${authoritativeCommit}\n`, stderr: "" };
    if (key === "rev-parse refs/remotes/origin/main") return { exitCode: 0, stdout: `${authoritativeCommit}\n`, stderr: "" };
    if (key === "ls-remote origin refs/heads/main refs/tags/v1.2.3 refs/tags/v1.2.3^{}") {
      return {
        exitCode: 0,
        stdout: `${authoritativeCommit}\trefs/heads/main\n${authoritativeCommit}\trefs/tags/v1.2.3\n`,
        stderr: "",
      };
    }
    assert.fail(`unexpected git command: ${key}`);
  };

  await assert.rejects(
    () => verifyReleaseSourceIdentity("1.2.3", run),
    /release\.source_commit_not_authoritative/u,
  );
  assert.deepEqual(calls[0], ["fetch", "--quiet", "origin", "main", "--tags"]);
  assert.equal(calls.some(([command]) => command === "ls-remote"), true);
});

test("release source identity accepts only the exact versioned main commit", async () => {
  const commit = "c".repeat(40);
  const run = async (args) => {
    const key = args.join(" ");
    if (key === "fetch --quiet origin main --tags") return { exitCode: 0, stdout: "", stderr: "" };
    if (key === "status --porcelain --untracked-files=normal") return { exitCode: 0, stdout: "", stderr: "" };
    if (["rev-parse HEAD", "rev-list -n 1 v1.2.3", "rev-parse refs/remotes/origin/main"].includes(key)) {
      return { exitCode: 0, stdout: `${commit}\n`, stderr: "" };
    }
    if (key === "ls-remote origin refs/heads/main refs/tags/v1.2.3 refs/tags/v1.2.3^{}") {
      return {
        exitCode: 0,
        stdout: `${commit}\trefs/heads/main\n${commit}\trefs/tags/v1.2.3\n`,
        stderr: "",
      };
    }
    if (key === `show ${commit}:package.json`) {
      return { exitCode: 0, stdout: JSON.stringify({ version: "1.2.3" }), stderr: "" };
    }
    assert.fail(`unexpected git command: ${key}`);
  };

  assert.deepEqual(await verifyReleaseSourceIdentity("1.2.3", run), {
    version: "1.2.3",
    tag: "v1.2.3",
    commit,
  });
});

test("release source snapshot contains only bytes from the bound commit", async () => {
  const markerName = `.release-source-snapshot-test-${process.pid}.tmp`;
  const markerPath = resolve(markerName);
  const dependencyMarkerName = `.release-source-dependency-test-${process.pid}.tmp`;
  const dependencyMarkerPath = resolve("node_modules", dependencyMarkerName);
  await writeFile(markerPath, "worktree-only bytes");
  await writeFile(dependencyMarkerPath, "mutable workspace dependency bytes");
  let snapshot;
  try {
    snapshot = await createReleaseSourceSnapshot({ commit: "HEAD", version: "0.0.1" });
    await assert.rejects(() => readFile(join(snapshot.root, markerName)), /ENOENT/u);
    await assert.rejects(
      () => readFile(join(snapshot.root, "node_modules", dependencyMarkerName)),
      /ENOENT/u,
    );
    assert.notEqual(snapshot.root, process.cwd());
  } finally {
    await snapshot?.cleanup();
    await rm(markerPath, { force: true });
    await rm(dependencyMarkerPath, { force: true });
  }
});

test("release rebuild uses only a private dependency tree and asset cache", async () => {
  const source = await readFile("scripts/release-npm-package.mjs", "utf8");
  assert.doesNotMatch(source, /symlink\([^\n]*node_modules|resolve\("node_modules"\)/u);
  assert.doesNotMatch(source, /resolve\("artifacts\/release-cache"\)/u);
  assert.match(source, /"ci",[\s\S]*?"--ignore-scripts"[\s\S]*?"--registry",\s*REGISTRY/u);
});

test("manual package release is preview-only unless --publish is explicit", async () => {
  const calls = [];
  const registryResults = [null, null, { version: "1.2.3", integrity: TEST_INTEGRITY }];
  const operations = withReleaseSource({
    inspect: async (tarballPath) => {
      calls.push(["inspect", tarballPath]);
      return { name: "@xiaozhiclaw/agent-computer-use-win32-x64", version: "1.2.3" };
    },
    registryPackage: async (name, version) => {
      calls.push(["registryPackage", name, version]);
      return registryResults.shift();
    },
    publish: async (tarballPath) => {
      calls.push(["publish", tarballPath]);
    },
    sourceArtifactSha512: async () => TEST_SHA512,
    sha512: async () => TEST_SHA512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
  });

  const preview = await runNpmPackageRelease(
    ["--package", "artifacts/release/agent-computer-use-win32-x64-1.2.3.tgz"],
    operations,
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.publishRequested, false);
  assert.equal(calls.some(([operation]) => operation === "publish"), false);

  const published = await runNpmPackageRelease(
    ["--package", "artifacts/release/agent-computer-use-win32-x64-1.2.3.tgz", "--publish"],
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
  const operations = withReleaseSource({
    inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.2.3" }),
    sourceArtifactSha512: async () => "expected-sha512",
    sha512: async () => "expected-sha512",
    snapshot: async () => { throw new Error("release.artifact_mismatch"); },
    registryPackage: async () => null,
    publish: async () => assert.fail("publish must remain unreachable"),
  });

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

test("release revalidates the bound source identity after artifact construction", async () => {
  const sourceIdentity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  let registryCalled = false;
  let publishCalled = false;
  const operations = {
    inspect: async () => ({
      name: "@xiaozhiclaw/agent-computer-use-win32-x64",
      version: "1.2.3",
    }),
    sourceIdentity: async () => sourceIdentity,
    sourceVersion: async (received) => {
      assert.equal(received, sourceIdentity);
      return "1.2.3";
    },
    sourceArtifactSha512: async (_name, _version, received) => {
      assert.equal(received, sourceIdentity);
      return "verified-sha512";
    },
    verifySourceIdentity: async () => { throw new Error("release.source_changed_after_build"); },
    sha512: async () => "verified-sha512",
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async () => { registryCalled = true; return null; },
    publish: async () => { publishCalled = true; },
  };

  await assert.rejects(
    () => runNpmPackageRelease([
      "--package",
      "agent-computer-use-win32-x64-1.2.3.tgz",
      "--publish",
    ], operations),
    /release\.source_changed_after_build/u,
  );
  assert.equal(registryCalled, false);
  assert.equal(publishCalled, false);
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
  let registryCalls = 0;
  const operations = createNpmReleaseOperations(async (args) => {
    calls.push(args);
    if (args[0] === "pack") {
      return {
        exitCode: 0,
        stdout: JSON.stringify([{
          name: "@xiaozhiclaw/agent-computer-use-win32-x64",
          version: "1.2.3",
        }]),
        stderr: "",
      };
    }
    if (args[0] === "view") {
      registryCalls += 1;
      return registryCalls === 1
        ? { exitCode: 1, stdout: "", stderr: "npm error code E404" }
        : {
            exitCode: 0,
            stdout: JSON.stringify({ version: "1.2.3", "dist.integrity": TEST_INTEGRITY }),
            stderr: "",
          };
    }
    return { exitCode: 0, stdout: "published", stderr: "" };
  });
  operations.sourceIdentity = async () => ({
    version: "1.2.3",
    tag: "v1.2.3",
    commit: "a".repeat(40),
  });
  operations.verifySourceIdentity = async () => {};
  operations.sourceArtifactSha512 = async () => TEST_SHA512;
  operations.sha512 = async () => TEST_SHA512;
  operations.waitForRegistry = async () => {};
  const snapshotPath = resolve("private-snapshot", "agent-computer-use-win32-x64-1.2.3.tgz");
  operations.snapshot = async () => ({ path: snapshotPath, cleanup: async () => {} });

  const report = await runNpmPackageRelease(
    ["--package", "agent-computer-use-win32-x64-1.2.3.tgz", "--publish"],
    operations,
  );

  assert.equal(report.status, "published");
  assert.deepEqual(calls, [
    ["pack", resolve("agent-computer-use-win32-x64-1.2.3.tgz"), "--dry-run", "--json"],
    [
      "view",
      "@xiaozhiclaw/agent-computer-use-win32-x64@1.2.3",
      "version",
      "dist.integrity",
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
    [
      "view",
      "@xiaozhiclaw/agent-computer-use-win32-x64@1.2.3",
      "version",
      "dist.integrity",
      "--json",
      "--registry",
      "https://registry.npmjs.org/",
    ],
  ]);
});

test("an existing registry version must match the canonical tarball integrity", async () => {
  const expectedSha512 = createHash("sha512").update("canonical-platform").digest("hex");
  let publishCalled = false;
  const identity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  const operations = {
    inspect: async () => ({
      name: "@xiaozhiclaw/agent-computer-use-win32-x64",
      version: "1.2.3",
    }),
    sourceIdentity: async () => identity,
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async () => expectedSha512,
    verifySourceIdentity: async () => {},
    sha512: async () => expectedSha512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async () => ({
      version: "1.2.3",
      integrity: "sha512-not-the-canonical-bytes",
    }),
    publish: async () => { publishCalled = true; },
  };

  await assert.rejects(
    () => runNpmPackageRelease([
      "--package",
      "agent-computer-use-win32-x64-1.2.3.tgz",
      "--publish",
    ], operations),
    /release\.registry_integrity_mismatch/u,
  );
  assert.equal(publishCalled, false);
});

test("core release fails closed unless the matching platform is already published", async () => {
  const coreSha512 = createHash("sha512").update("canonical-core").digest("hex");
  const platformSha512 = createHash("sha512").update("canonical-platform").digest("hex");
  const registryCalls = [];
  let publishCalled = false;
  const identity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  const operations = {
    inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.2.3" }),
    sourceIdentity: async () => identity,
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async (name) => name === "agent-computer-use-mcp"
      ? coreSha512
      : platformSha512,
    verifySourceIdentity: async () => {},
    sha512: async () => coreSha512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async (name) => { registryCalls.push(name); return null; },
    publish: async () => { publishCalled = true; },
  };

  for (const publish of [false, true]) {
    const args = ["--package", "agent-computer-use-mcp-1.2.3.tgz"];
    if (publish) args.push("--publish");
    await assert.rejects(
      () => runNpmPackageRelease(args, operations),
      /release\.platform_registry_missing/u,
    );
  }
  assert.deepEqual(registryCalls, [
    "@xiaozhiclaw/agent-computer-use-win32-x64",
    "@xiaozhiclaw/agent-computer-use-win32-x64",
  ]);
  assert.equal(publishCalled, false);
});

test("core publication binds its platform preflight to the local protected artifact", async () => {
  const coreSha512 = createHash("sha512").update("canonical-core").digest("hex");
  const platformSha512 = createHash("sha512").update("canonical-platform").digest("hex");
  const sri = (sha512) => `sha512-${Buffer.from(sha512, "hex").toString("base64")}`;
  const artifactBuilds = [];
  const registryCalls = [];
  const identity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  let coreQueries = 0;
  let publishCalls = 0;
  const operations = {
    inspect: async () => ({ name: "agent-computer-use-mcp", version: "1.2.3" }),
    sourceIdentity: async () => identity,
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async (name) => {
      artifactBuilds.push(name);
      return name === "agent-computer-use-mcp" ? coreSha512 : platformSha512;
    },
    verifySourceIdentity: async () => {},
    sha512: async () => coreSha512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async (name) => {
      registryCalls.push(name);
      if (name !== "agent-computer-use-mcp") {
        return { version: "1.2.3", integrity: sri(platformSha512) };
      }
      coreQueries += 1;
      return coreQueries === 1 ? null : { version: "1.2.3", integrity: sri(coreSha512) };
    },
    waitForRegistry: async () => {},
    publish: async () => { publishCalls += 1; },
  };

  const report = await runNpmPackageRelease([
    "--package",
    "agent-computer-use-mcp-1.2.3.tgz",
    "--publish",
  ], operations);
  assert.equal(report.status, "published");
  assert.deepEqual(artifactBuilds, [
    "agent-computer-use-mcp",
    "@xiaozhiclaw/agent-computer-use-win32-x64",
  ]);
  assert.deepEqual(registryCalls, [
    "@xiaozhiclaw/agent-computer-use-win32-x64",
    "agent-computer-use-mcp",
    "agent-computer-use-mcp",
  ]);
  assert.equal(publishCalls, 1);
});

test("publication retries until registry version and integrity match", async () => {
  const expectedSha512 = createHash("sha512").update("canonical-platform").digest("hex");
  const expectedIntegrity = `sha512-${Buffer.from(expectedSha512, "hex").toString("base64")}`;
  const identity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  const registryResults = [
    null,
    null,
    { version: "1.2.3", integrity: expectedIntegrity },
  ];
  let publishCalls = 0;
  const operations = {
    inspect: async () => ({
      name: "@xiaozhiclaw/agent-computer-use-win32-x64",
      version: "1.2.3",
    }),
    sourceIdentity: async () => identity,
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async () => expectedSha512,
    verifySourceIdentity: async () => {},
    sha512: async () => expectedSha512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async () => registryResults.shift(),
    waitForRegistry: async () => {},
    publish: async () => { publishCalls += 1; },
  };

  const report = await runNpmPackageRelease([
    "--package",
    "agent-computer-use-win32-x64-1.2.3.tgz",
    "--publish",
  ], operations);
  assert.equal(report.status, "published");
  assert.equal(publishCalls, 1);
  assert.equal(registryResults.length, 0);
});

test("publication fails after a bounded registry verification window", async () => {
  const expectedSha512 = createHash("sha512").update("canonical-platform").digest("hex");
  const identity = { version: "1.2.3", tag: "v1.2.3", commit: "a".repeat(40) };
  let registryCalls = 0;
  let publishCalls = 0;
  const operations = {
    inspect: async () => ({
      name: "@xiaozhiclaw/agent-computer-use-win32-x64",
      version: "1.2.3",
    }),
    sourceIdentity: async () => identity,
    sourceVersion: async () => "1.2.3",
    sourceArtifactSha512: async () => expectedSha512,
    verifySourceIdentity: async () => {},
    sha512: async () => expectedSha512,
    snapshot: async (_sourcePath, canonicalFilename) => ({
      path: resolve("private-snapshot", canonicalFilename),
      cleanup: async () => {},
    }),
    registryPackage: async () => { registryCalls += 1; return null; },
    waitForRegistry: async () => {},
    publish: async () => { publishCalls += 1; },
  };

  await assert.rejects(
    () => runNpmPackageRelease([
      "--package",
      "agent-computer-use-win32-x64-1.2.3.tgz",
      "--publish",
    ], operations),
    /release\.postpublish_verification_failed/u,
  );
  assert.equal(registryCalls, 4);
  assert.equal(publishCalls, 1);
});

test("registry lookup cannot swap the bytes selected for publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-computer-use-release-toctou-"));
  const packagePath = join(root, "agent-computer-use-win32-x64-1.2.3.tgz");
  const verifiedBytes = Buffer.from("verified-tarball-bytes");
  const replacementBytes = Buffer.from("replacement-tarball-bytes");
  const expectedSha512 = createHash("sha512").update(verifiedBytes).digest("hex");
  let publishedPath;
  let publishedBytes;
  try {
    await writeFile(packagePath, verifiedBytes);
    const operations = createNpmReleaseOperations(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{
        name: "@xiaozhiclaw/agent-computer-use-win32-x64",
        version: "1.2.3",
      }]),
      stderr: "",
    }));
    operations.sourceIdentity = async () => ({
      version: "1.2.3",
      tag: "v1.2.3",
      commit: "a".repeat(40),
    });
    operations.verifySourceIdentity = async () => {};
    operations.sourceArtifactSha512 = async () => expectedSha512;
    let registryCalls = 0;
    operations.registryPackage = async () => {
      registryCalls += 1;
      if (registryCalls === 1) {
        await writeFile(packagePath, replacementBytes);
        return null;
      }
      return {
        version: "1.2.3",
        integrity: `sha512-${Buffer.from(expectedSha512, "hex").toString("base64")}`,
      };
    };
    operations.waitForRegistry = async () => {};
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
  const packagePath = join(root, "agent-computer-use-win32-x64-1.2.3.tgz");
  const bytes = Buffer.from("verified-tarball-bytes");
  const expectedSha512 = createHash("sha512").update(bytes).digest("hex");
  let registryCalled = false;
  let publishCalled = false;
  try {
    await writeFile(packagePath, bytes);
    const operations = withReleaseSource({
      inspect: async () => ({
        name: "@xiaozhiclaw/agent-computer-use-win32-x64",
        version: "1.2.3",
      }),
      sourceArtifactSha512: async () => expectedSha512,
      sha512: async () => expectedSha512,
      snapshot: (...args) => createVerifiedSnapshot(...args, {
        platform: "win32",
        hardenDirectory: async () => { throw new Error("release.snapshot_acl_failed"); },
      }),
      registryPackage: async () => { registryCalled = true; return null; },
      publish: async () => { publishCalled = true; },
    });

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
