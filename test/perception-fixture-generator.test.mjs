import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

import { parsePerceptionCorpusManifest } from "../src/perception-corpus.mjs";
import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";

test("quick corpus generation is byte deterministic for the approved seed", async (t) => {
  const first = await temporaryDirectory(t, "acu-perception-quick-a-");
  const second = await temporaryDirectory(t, "acu-perception-quick-b-");

  const firstManifest = await generateQuickCorpus({ outputRoot: first, seed: 20260713 });
  const secondManifest = await generateQuickCorpus({ outputRoot: second, seed: 20260713 });

  assert.deepEqual(firstManifest, secondManifest);
  const firstFiles = await readTree(first);
  const secondFiles = await readTree(second);
  assert.deepEqual([...firstFiles.keys()], [...secondFiles.keys()]);
  for (const [target, bytes] of firstFiles) assert.deepEqual(bytes, secondFiles.get(target), target);
  assert.deepEqual(JSON.parse(await readFile(join(first, "manifest.json"), "utf8")), firstManifest);
});

test("a different seed changes pixels without weakening schema coverage", async (t) => {
  const first = await temporaryDirectory(t, "acu-perception-seed-a-");
  const second = await temporaryDirectory(t, "acu-perception-seed-b-");
  const baseline = parsePerceptionCorpusManifest(
    await generateQuickCorpus({ outputRoot: first, seed: 20260713 }),
    { tier: "quick" },
  );
  const changed = parsePerceptionCorpusManifest(
    await generateQuickCorpus({ outputRoot: second, seed: 20260714 }),
    { tier: "quick" },
  );

  assert.deepEqual(coverage(changed), coverage(baseline));
  assert.deepEqual(changed.samples.map((sample) => sample.id), baseline.samples.map((sample) => sample.id));
  assert.equal(
    changed.samples.some((sample, index) => sample.image.sha256 !== baseline.samples[index].image.sha256),
    true,
  );
});

test("quick corpus covers approved text and complex UI surface families", async (t) => {
  const root = await temporaryDirectory(t, "acu-perception-coverage-");
  const manifest = parsePerceptionCorpusManifest(
    await generateQuickCorpus({ outputRoot: root, seed: 20260713 }),
    { tier: "quick" },
  );

  assert.deepEqual(
    new Set(manifest.samples.filter((sample) => sample.kind === "ocr").map((sample) => sample.annotation.languageClass)),
    new Set(["chinese", "english", "numeric", "mixed"]),
  );
  assert.deepEqual(new Set(manifest.samples.map((sample) => sample.theme)), new Set(["light", "dark"]));
  assert.deepEqual(new Set(manifest.samples.map((sample) => sample.dpi)), new Set([100, 125, 150]));
  assert.deepEqual(
    new Set(manifest.samples.filter((sample) => sample.kind === "visual").map((sample) => sample.annotation.surfaceClass)),
    new Set(["canvas", "timeline", "cad-like", "toolbar", "dialog", "table", "editor"]),
  );
  assert.equal(new Set(manifest.samples.map((sample) => sample.applicationClass)).size >= 8, true);
  assert.equal(manifest.samples.every((sample) => sample.image.target.endsWith(".png")), true);
  assert.equal(manifest.samples.filter((sample) => sample.kind === "visual")
    .every((sample) => sample.annotation.ignored.length > 0), true);
  assert.deepEqual(
    new Set(manifest.samples.filter((sample) => sample.kind === "ocr").map((sample) => latencyClass(sample.annotation.region))),
    new Set(["small-ui-crop", "ordinary-window-region", "full-window-diagnostic"]),
  );
});

function coverage(manifest) {
  return {
    kinds: [...new Set(manifest.samples.map((sample) => sample.kind))].sort(),
    languages: [...new Set(manifest.samples.filter((sample) => sample.kind === "ocr")
      .map((sample) => sample.annotation.languageClass))].sort(),
    surfaces: [...new Set(manifest.samples.filter((sample) => sample.kind === "visual")
      .map((sample) => sample.annotation.surfaceClass))].sort(),
    classes: [...new Set(manifest.samples.map((sample) => sample.applicationClass))].sort(),
    dpis: [...new Set(manifest.samples.map((sample) => sample.dpi))].sort((a, b) => a - b),
    themes: [...new Set(manifest.samples.map((sample) => sample.theme))].sort(),
  };
}

function latencyClass(region) {
  if (region.width >= 800 && region.height >= 480) return "full-window-diagnostic";
  if (region.width * region.height > 100_000) return "ordinary-window-region";
  return "small-ui-crop";
}

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function readTree(root, directory = root, output = new Map()) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await readTree(root, path, output);
    else output.set(relative(root, path).split(sep).join("/"), await readFile(path));
  }
  return new Map([...output].sort(([a], [b]) => a.localeCompare(b, "en")));
}
