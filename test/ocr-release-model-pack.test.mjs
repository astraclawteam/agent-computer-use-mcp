import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { stringify } from "yaml";

import { buildPpOcrV6SmallPack } from "../src/ocr-release-model-pack.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("official PP-OCRv6 metadata becomes the exact ONNX sidecar model pack", async () => {
  const root = await fixtureRoot();
  const detPath = join(root, "det.onnx");
  const recPath = join(root, "rec.onnx");
  const metadataPath = join(root, "inference.yml");
  const detBytes = Buffer.from("det-onnx-fixture", "utf8");
  const recBytes = Buffer.from("rec-onnx-fixture", "utf8");
  const characters = Array.from({ length: 18_708 }, (_, index) => `c${index}`);
  await writeFile(detPath, detBytes);
  await writeFile(recPath, recBytes);
  await writeFile(metadataPath, stringify({
    Global: { model_name: "PP-OCRv6_small_rec" },
    PostProcess: { name: "CTCLabelDecode", character_dict: characters },
  }), "utf8");

  const report = await buildPpOcrV6SmallPack({
    detPath,
    recPath,
    metadataPath,
    outputRoot: join(root, "model-pack"),
    expected: {
      det: identity(detBytes),
      rec: identity(recBytes),
    },
  });

  assert.equal(report.status, "ready");
  assert.equal(report.modelFormat, "onnx");
  assert.equal(report.sourceDictionaryEntries, 18_708);
  assert.equal(report.dictionaryEntries, 18_709);
  assert.deepEqual(report.files.map((file) => file.name), [
    "PP-OCRv6_det_small.onnx",
    "PP-OCRv6_rec_small.onnx",
    "ppocrv6_dict.txt",
  ]);
  const dictionary = await readFile(join(report.root, "ppocrv6_dict.txt"), "utf8");
  const entries = dictionary.split("\n");
  assert.equal(entries.length, 18_709);
  assert.equal(entries.at(-1), " ");
  assert.equal(dictionary.endsWith("\n"), false);
});

test("PP-OCRv6 release pack rejects metadata and ONNX identity mismatches", async () => {
  const root = await fixtureRoot();
  const detPath = join(root, "det.onnx");
  const recPath = join(root, "rec.onnx");
  const metadataPath = join(root, "inference.yml");
  const detBytes = Buffer.from("det", "utf8");
  const recBytes = Buffer.from("rec", "utf8");
  await writeFile(detPath, detBytes);
  await writeFile(recPath, recBytes);
  await writeFile(metadataPath, stringify({ PostProcess: { name: "WrongDecoder", character_dict: ["A"] } }));

  await assert.rejects(
    () => buildPpOcrV6SmallPack({
      detPath,
      recPath,
      metadataPath,
      outputRoot: join(root, "bad-metadata"),
      expected: { det: identity(detBytes), rec: identity(recBytes) },
    }),
    (error) => error?.code === "release.ocr_metadata_invalid",
  );

  await writeFile(metadataPath, stringify({ PostProcess: { name: "CTCLabelDecode", character_dict: ["A"] } }));
  await assert.rejects(
    () => buildPpOcrV6SmallPack({
      detPath,
      recPath,
      metadataPath,
      outputRoot: join(root, "bad-hash"),
      expected: { det: { ...identity(detBytes), sha256: "0".repeat(64) }, rec: identity(recBytes) },
    }),
    (error) => error?.code === "release.ocr_model_identity_mismatch",
  );
});

function identity(bytes) {
  return { sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "agent-ocr-release-pack-"));
  roots.push(root);
  return root;
}
