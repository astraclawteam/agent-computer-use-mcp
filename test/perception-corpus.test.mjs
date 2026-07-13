import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  FULL_CORPUS_MINIMUMS,
  parsePerceptionCorpusManifest,
  verifyPerceptionCorpus,
} from "../src/perception-corpus.mjs";

test("full corpus manifest enforces approved inventory dimensions", () => {
  const manifest = fullManifestShape();
  const parsed = parsePerceptionCorpusManifest(manifest, { tier: "full" });

  assert.equal(parsed.samples.length, 600);
  assert.deepEqual(FULL_CORPUS_MINIMUMS.ocrByLanguage, {
    chinese: 150,
    english: 150,
    numeric: 50,
    mixed: 50,
  });
  assert.equal(new Set(parsed.samples.map((sample) => sample.applicationClass)).size >= 8, true);
  assert.deepEqual(new Set(parsed.samples.map((sample) => sample.dpi)), new Set([100, 125, 150]));
  assert.deepEqual(new Set(parsed.samples.map((sample) => sample.theme)), new Set(["light", "dark"]));
});

test("manifest rejects missing categories, malformed annotations, duplicate IDs, and unsafe paths", () => {
  const missing = fullManifestShape();
  for (const sample of missing.samples.filter((entry) => entry.kind === "ocr" && entry.annotation.languageClass === "chinese")) {
    sample.annotation.languageClass = "english";
  }
  assert.throws(() => parsePerceptionCorpusManifest(missing, { tier: "full" }), /perception\.corpus_ocr_chinese_insufficient/u);

  const malformed = quickManifestShape();
  delete malformed.samples[0].annotation.region.width;
  assert.throws(() => parsePerceptionCorpusManifest(malformed, { tier: "quick" }), /perception\.corpus_region_invalid/u);

  const duplicate = quickManifestShape();
  duplicate.samples[1].id = duplicate.samples[0].id;
  assert.throws(() => parsePerceptionCorpusManifest(duplicate, { tier: "quick" }), /perception\.corpus_sample_id_duplicate/u);

  const traversal = quickManifestShape();
  traversal.samples[0].image.target = "../private.png";
  assert.throws(() => parsePerceptionCorpusManifest(traversal, { tier: "quick" }), /perception\.corpus_target_unsafe/u);

  const collision = quickManifestShape();
  collision.samples[1].image.target = collision.samples[0].image.target.toUpperCase();
  assert.throws(() => parsePerceptionCorpusManifest(collision, { tier: "quick" }), /perception\.corpus_target_duplicate/u);
});

test("verified corpus checks manifest and asset identities without exposing its root", async (t) => {
  const fixture = await createQuickCorpus(t);
  const corpus = await verifyPerceptionCorpus({ root: fixture.root, lock: fixture.lock, tier: "quick" });

  assert.equal(corpus.status, "verified");
  assert.equal(corpus.tier, "quick");
  assert.equal(corpus.samples.length, fixture.manifest.samples.length);
  assert.equal(typeof corpus.resolveImagePath, "function");
  assert.equal(corpus.resolveImagePath(corpus.samples[0].id).startsWith(fixture.root), true);
  assert.throws(() => corpus.resolveImagePath("missing-sample"), /perception\.corpus_sample_unknown/u);
  assert.equal(JSON.stringify(corpus).includes(fixture.root), false);
});

test("corpus verification rejects hash mismatch and unreferenced files", async (t) => {
  const fixture = await createQuickCorpus(t);
  await writeFile(join(fixture.root, fixture.manifest.samples[0].image.target), "tampered");
  await assert.rejects(
    verifyPerceptionCorpus({ root: fixture.root, lock: fixture.lock, tier: "quick" }),
    /perception\.corpus_(size|hash)_mismatch/u,
  );

  const extra = await createQuickCorpus(t);
  await writeFile(join(extra.root, "unreferenced.txt"), "not declared");
  await assert.rejects(
    verifyPerceptionCorpus({ root: extra.root, lock: extra.lock, tier: "quick" }),
    /perception\.corpus_unreferenced_file/u,
  );
});

test("corpus verification rejects a symlink or junction in an asset path", async (t) => {
  const fixture = await createQuickCorpus(t);
  const outside = await mkdtemp(join(tmpdir(), "acu-corpus-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "sample.png"), "outside");
  await rm(join(fixture.root, "images"), { recursive: true, force: true });
  await symlink(outside, join(fixture.root, "images"), process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    verifyPerceptionCorpus({ root: fixture.root, lock: fixture.lock, tier: "quick" }),
    /perception\.corpus_linked_path_forbidden/u,
  );
});

test("repository full corpus lock is honest about its unpublished identity", async () => {
  const lock = JSON.parse(await readFile("docs/productization/perception-corpus.lock.json", "utf8"));
  assert.equal(lock.packId, "agent-computer-use-perception-corpus");
  assert.equal(lock.identityStatus, "pending");
  await assert.rejects(
    verifyPerceptionCorpus({ root: "artifacts/perception-corpus/current", lock, tier: "full" }),
    /perception\.corpus_identity_pending/u,
  );
});

async function createQuickCorpus(t) {
  const root = await mkdtemp(join(tmpdir(), "acu-perception-corpus-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = quickManifestShape();
  for (const entry of [...manifest.licenses, ...manifest.samples.map((sample) => sample.image)]) {
    const bytes = Buffer.from(`bytes:${entry.target}`, "utf8");
    entry.sizeBytes = bytes.length;
    entry.sha256 = sha256(bytes);
    await mkdir(dirname(join(root, entry.target)), { recursive: true });
    await writeFile(join(root, entry.target), bytes);
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(root, "manifest.json"), manifestBytes);
  return {
    root,
    manifest,
    lock: {
      schemaVersion: 1,
      packId: manifest.packId,
      version: manifest.version,
      identityStatus: "locked",
      manifest: identity("manifest.json", manifestBytes),
    },
  };
}

function quickManifestShape() {
  const samples = [
    ocrSample("ocr-cn", "chinese", "保存", "images/ocr-cn.png", 100, "light", "native-form"),
    ocrSample("ocr-en", "english", "Save", "images/ocr-en.png", 125, "dark", "editor"),
    ocrSample("ocr-number", "numeric", "125.50", "images/ocr-number.png", 150, "light", "table"),
    ocrSample("ocr-mixed", "mixed", "轨道 A1", "images/ocr-mixed.png", 100, "dark", "timeline"),
    visualSample("visual-canvas", "images/visual-canvas.png", 125, "light", "canvas", "canvas"),
    visualSample("visual-cad", "images/visual-cad.png", 150, "dark", "cad", "cad-like"),
    visualSample("visual-toolbar", "images/visual-toolbar.png", 100, "light", "toolbar", "toolbar"),
    visualSample("visual-dialog", "images/visual-dialog.png", 125, "dark", "dialog", "dialog"),
  ];
  return {
    schemaVersion: 1,
    packId: "agent-computer-use-perception-quick",
    version: "1.0.0-test",
    tier: "quick",
    provenance: "generated",
    licenses: [{ id: "generated-mit", spdx: "MIT", target: "LICENSE.txt", sizeBytes: 1, sha256: "a".repeat(64) }],
    samples,
  };
}

function fullManifestShape() {
  const manifest = quickManifestShape();
  manifest.packId = "agent-computer-use-perception-corpus";
  manifest.tier = "full";
  manifest.samples = [];
  const classes = ["native-form", "editor", "table", "timeline", "canvas", "cad", "toolbar", "dialog"];
  const dpis = [100, 125, 150];
  const themes = ["light", "dark"];
  const languages = [
    ["chinese", 150, "保存"],
    ["english", 150, "Save"],
    ["numeric", 50, "125.50"],
    ["mixed", 50, "轨道 A1"],
  ];
  let index = 0;
  for (const [language, count, text] of languages) {
    for (let i = 0; i < count; i += 1) {
      manifest.samples.push(ocrSample(
        `ocr-${language}-${i}`,
        language,
        text,
        `images/ocr-${index}.png`,
        dpis[index % dpis.length],
        themes[index % themes.length],
        classes[index % classes.length],
      ));
      index += 1;
    }
  }
  for (let i = 0; i < 200; i += 1) {
    manifest.samples.push(visualSample(
      `visual-${i}`,
      `images/visual-${i}.png`,
      dpis[i % dpis.length],
      themes[i % themes.length],
      classes[i % classes.length],
      i % 2 === 0 ? "canvas" : "cad-like",
    ));
  }
  return manifest;
}

function ocrSample(id, languageClass, text, target, dpi, theme, applicationClass) {
  return {
    id,
    kind: "ocr",
    applicationClass,
    dpi,
    theme,
    licenseId: "generated-mit",
    image: { target, sizeBytes: 1, sha256: "b".repeat(64) },
    annotation: {
      normalizedText: text,
      languageClass,
      criticalLabel: true,
      region: { x: 0, y: 0, width: 96, height: 32 },
    },
  };
}

function visualSample(id, target, dpi, theme, applicationClass, surfaceClass) {
  return {
    id,
    kind: "visual",
    applicationClass,
    dpi,
    theme,
    licenseId: "generated-mit",
    image: { target, sizeBytes: 1, sha256: "c".repeat(64) },
    annotation: {
      surfaceClass,
      targets: [{ box: { x: 8, y: 8, width: 32, height: 24 }, role: "button", label: "Save", actionable: true }],
      ignored: [{ box: { x: 48, y: 8, width: 8, height: 8 }, reason: "decoration" }],
    },
  };
}

function identity(target, bytes) {
  return { target, sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
