import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parsePerceptionCorpusManifest } from "../src/perception-corpus.mjs";
import { generateQuickCorpus } from "../src/perception-fixture-generator.mjs";
import { scanCorpusPrivacy } from "../src/perception-privacy-scanner.mjs";

test("privacy scanner accepts generated UI crops without retaining their text or root", async (t) => {
  const fixture = await generatedFixture(t);
  const report = await scanCorpusPrivacy({ manifest: fixture.manifest, root: fixture.root });

  assert.equal(report.status, "passed");
  assert.equal(report.scannedSamples, fixture.manifest.samples.length);
  assert.deepEqual(report.violations, []);
  assert.equal(JSON.stringify(report).includes(fixture.root), false);
  assert.equal(JSON.stringify(report).includes("导出时间线"), false);
});

test("privacy scanner rejects private strings by stable category", async (t) => {
  const cases = [
    ["C:\\Users\\Alice\\Documents\\secret.txt", "private-path"],
    ["alice@example.com", "contact"],
    ["13812345678", "contact"],
    ["Password: hunter2", "credential"],
    ["Credit Card CVV", "payment"],
    ["Recent Files: private.docx", "recent-file"],
    ["GPS 22.5431, 114.0579", "location-or-network"],
    ["host=DESKTOP-ALICE", "location-or-network"],
    ["192.168.1.42", "location-or-network"],
  ];
  for (const [value, expectedCategory] of cases) {
    const fixture = await generatedFixture(t);
    fixture.manifest.samples[0].annotation.normalizedText = value;
    const report = await scanCorpusPrivacy({ manifest: fixture.manifest, root: fixture.root });
    assert.equal(report.status, "rejected", value);
    assert.equal(report.violations.some((entry) => entry.category === expectedCategory), true, value);
    assert.equal(JSON.stringify(report).includes(value), false, value);
  }
});

test("privacy scanner rejects PNG text EXIF and color-profile metadata", async (t) => {
  for (const chunkType of ["tEXt", "zTXt", "iTXt", "eXIf", "iCCP"]) {
    const fixture = await generatedFixture(t);
    const sample = fixture.manifest.samples[0];
    const path = join(fixture.root, ...sample.image.target.split("/"));
    const png = await readFile(path);
    await writeFile(path, insertChunkBeforeIend(png, chunkType, Buffer.from("private=value", "utf8")));

    const report = await scanCorpusPrivacy({ manifest: fixture.manifest, root: fixture.root });
    assert.equal(report.status, "rejected", chunkType);
    assert.equal(report.violations.some((entry) => entry.category === "png-metadata"), true, chunkType);
  }
});

test("privacy scanner rejects full desktop images and annotations outside image bounds", async (t) => {
  const desktop = await generatedFixture(t);
  const desktopSample = desktop.manifest.samples[0];
  const desktopPath = join(desktop.root, ...desktopSample.image.target.split("/"));
  const desktopPng = Buffer.from(await readFile(desktopPath));
  desktopPng.writeUInt32BE(1920, 16);
  desktopPng.writeUInt32BE(1080, 20);
  await writeFile(desktopPath, desktopPng);
  const desktopReport = await scanCorpusPrivacy({ manifest: desktop.manifest, root: desktop.root });
  assert.equal(desktopReport.violations.some((entry) => entry.category === "full-desktop"), true);

  const outside = await generatedFixture(t);
  outside.manifest.samples[0].annotation.region.width = 1000;
  const outsideReport = await scanCorpusPrivacy({ manifest: outside.manifest, root: outside.root });
  assert.equal(outsideReport.violations.some((entry) => entry.category === "bounds"), true);
});

test("privacy scanner fails closed for unlicensed samples and malformed PNGs", async (t) => {
  const unlicensed = await generatedFixture(t);
  unlicensed.manifest.samples[0].licenseId = "missing-license";
  const licenseReport = await scanCorpusPrivacy({ manifest: unlicensed.manifest, root: unlicensed.root });
  assert.equal(licenseReport.violations.some((entry) => entry.category === "license"), true);

  const malformed = await generatedFixture(t);
  const sample = malformed.manifest.samples[0];
  await writeFile(join(malformed.root, ...sample.image.target.split("/")), Buffer.from("not-png"));
  const malformedReport = await scanCorpusPrivacy({ manifest: malformed.manifest, root: malformed.root });
  assert.equal(malformedReport.violations.some((entry) => entry.category === "png-invalid"), true);
});

async function generatedFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "acu-privacy-corpus-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = structuredClone(await generateQuickCorpus({ outputRoot: root, seed: 20260713 }));
  parsePerceptionCorpusManifest(manifest, { tier: "quick" });
  return { root, manifest };
}

function insertChunkBeforeIend(png, type, data) {
  const iendOffset = png.length - 12;
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, "ascii");
  data.copy(chunk, 8);
  return Buffer.concat([png.subarray(0, iendOffset), chunk, png.subarray(iendOffset)]);
}
