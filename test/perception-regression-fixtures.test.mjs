import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { extractRegressions } from "../scripts/extract-perception-regressions.mjs";
import { verifyPerceptionCorpus } from "../src/perception-corpus.mjs";
import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";

test("extractor copies only failed samples with exact source identities and annotations", async (t) => {
  const fixture = await corpusFixture(t);
  const outputRoot = await temporaryDirectory(t, "acu-regressions-output-");
  const failed = [fixture.corpus.samples[5], fixture.corpus.samples[1]];

  const manifest = await extractRegressions({
    report: regressionReport(fixture.corpus, failed.map((sample) => sample.id)),
    corpus: fixture.corpus,
    outputRoot,
  });

  assert.deepEqual(manifest.samples.map((sample) => sample.id), failed.map((sample) => sample.id).sort());
  for (const sample of manifest.samples) {
    const source = fixture.corpus.samples.find((candidate) => candidate.id === sample.id);
    assert.deepEqual(sample.image, source.image);
    assert.deepEqual(sample.annotation, source.annotation);
    assert.deepEqual(await readFile(join(outputRoot, ...sample.image.target.split("/"))), await readFile(fixture.corpus.resolveImagePath(sample.id)));
  }
});

test("extractor rejects duplicate regression IDs", async (t) => {
  const fixture = await corpusFixture(t);
  const outputRoot = await temporaryDirectory(t, "acu-regressions-duplicate-");
  const sampleId = fixture.corpus.samples[0].id;

  await assert.rejects(
    extractRegressions({
      report: regressionReport(fixture.corpus, [sampleId, sampleId]),
      corpus: fixture.corpus,
      outputRoot,
    }),
    /perception\.regression_sample_duplicate/u,
  );
});

test("extractor requires the copied regression corpus to pass privacy policy", async (t) => {
  const fixture = await corpusFixture(t, (manifest) => {
    manifest.samples[0].annotation.normalizedText = "Password: private-value";
  });
  const outputRoot = await temporaryDirectory(t, "acu-regressions-private-");

  await assert.rejects(
    extractRegressions({
      report: regressionReport(fixture.corpus, [fixture.corpus.samples[0].id]),
      corpus: fixture.corpus,
      outputRoot,
    }),
    /perception\.regression_privacy_rejected/u,
  );
});

test("extractor output order is stable regardless of report order", async (t) => {
  const fixture = await corpusFixture(t);
  const ids = [fixture.corpus.samples[8].id, fixture.corpus.samples[2].id, fixture.corpus.samples[6].id];
  const leftRoot = await temporaryDirectory(t, "acu-regressions-left-");
  const rightRoot = await temporaryDirectory(t, "acu-regressions-right-");

  const left = await extractRegressions({ report: regressionReport(fixture.corpus, ids), corpus: fixture.corpus, outputRoot: leftRoot });
  const right = await extractRegressions({ report: regressionReport(fixture.corpus, ids.toReversed()), corpus: fixture.corpus, outputRoot: rightRoot });

  assert.deepEqual(left, right);
  assert.deepEqual(left.samples.map((sample) => sample.id), [...ids].sort());
});

function regressionReport(corpus, sampleIds) {
  return {
    schemaVersion: 1,
    benchmark: "perception-corpus-gate",
    corpus: { packId: corpus.packId, version: corpus.version, tier: corpus.tier },
    regressions: sampleIds.map((sampleId) => ({ sampleId, failures: [{ code: "proposal.false-positive" }] })),
  };
}

async function corpusFixture(t, mutate = () => {}) {
  const root = await temporaryDirectory(t, "acu-regressions-source-");
  const manifest = await generateQuickCorpus({ outputRoot: root, seed: 20260713 });
  mutate(manifest);
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestBytes = await readFile(join(root, "manifest.json"));
  const lock = {
    schemaVersion: 1,
    packId: manifest.packId,
    version: manifest.version,
    identityStatus: "locked",
    manifest: {
      target: "manifest.json",
      sizeBytes: manifestBytes.length,
      sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    },
  };
  return { root, corpus: await verifyPerceptionCorpus({ root, lock, tier: "quick" }) };
}

async function temporaryDirectory(t, prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
