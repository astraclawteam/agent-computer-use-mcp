import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export const FULL_CORPUS_MINIMUMS = Object.freeze({
  ocr: 400,
  visual: 200,
  applicationClasses: 8,
  ocrByLanguage: Object.freeze({ chinese: 150, english: 150, numeric: 50, mixed: 50 }),
  dpis: Object.freeze([100, 125, 150]),
  themes: Object.freeze(["light", "dark"]),
});

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SPDX_PATTERN = /^[A-Za-z0-9-.+]+$/u;
const LANGUAGE_CLASSES = new Set(Object.keys(FULL_CORPUS_MINIMUMS.ocrByLanguage));
const THEMES = new Set(FULL_CORPUS_MINIMUMS.themes);
const TIERS = new Set(["quick", "full"]);

export function parsePerceptionCorpusManifest(value, options = {}) {
  if (!isRecord(value) || value.schemaVersion !== 1) throw corpusError("perception.corpus_schema_unsupported");
  const packId = requiredString(value.packId, "perception.corpus_pack_id_required");
  const version = requiredString(value.version, "perception.corpus_version_required");
  const tier = requiredString(value.tier, "perception.corpus_tier_required");
  if (!TIERS.has(tier) || (options.tier && options.tier !== tier)) throw corpusError("perception.corpus_tier_mismatch");
  if (!new Set(["generated", "public", "mixed"]).has(value.provenance)) {
    throw corpusError("perception.corpus_provenance_invalid");
  }
  if (!Array.isArray(value.licenses) || value.licenses.length === 0) {
    throw corpusError("perception.corpus_license_required");
  }

  const targets = new Set();
  const licenseIds = new Set();
  const licenses = value.licenses.map((license) => {
    if (!isRecord(license)) throw corpusError("perception.corpus_license_invalid");
    const id = requiredString(license.id, "perception.corpus_license_id_required");
    if (licenseIds.has(id)) throw corpusError("perception.corpus_license_id_duplicate", id);
    licenseIds.add(id);
    if (!SPDX_PATTERN.test(license.spdx ?? "")) throw corpusError("perception.corpus_license_spdx_invalid", id);
    return Object.freeze({ id, spdx: license.spdx, ...validateIdentity(license, targets) });
  });

  if (!Array.isArray(value.samples) || value.samples.length === 0) {
    throw corpusError("perception.corpus_samples_required");
  }
  const sampleIds = new Set();
  const samples = value.samples.map((sample) => parseSample(sample, { sampleIds, targets, licenseIds }));
  if (tier === "full") validateFullInventory(samples);

  return Object.freeze({
    schemaVersion: 1,
    packId,
    version,
    tier,
    provenance: value.provenance,
    licenses: Object.freeze(licenses),
    samples: Object.freeze(samples),
  });
}

export async function verifyPerceptionCorpus(options = {}) {
  const lock = validateCorpusLock(options.lock);
  const tier = options.tier ?? "full";
  const root = resolve(options.root ?? process.env.AGENT_COMPUTER_USE_PERCEPTION_CORPUS
    ?? "artifacts/perception-corpus/current");
  const physicalRoot = await realpath(root).catch(() => {
    throw corpusError("perception.corpus_pack_missing");
  });
  await assertNoLinkedPath(root, "");
  await verifyFile({ root, physicalRoot, identity: lock.manifest });

  const manifestPath = joinTarget(root, lock.manifest.target);
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest = parsePerceptionCorpusManifest(manifestValue, { tier });
  if (manifest.packId !== lock.packId || manifest.version !== lock.version) {
    throw corpusError("perception.corpus_lock_mismatch");
  }

  for (const license of manifest.licenses) {
    await verifyFile({ root, physicalRoot, identity: license });
  }
  for (const sample of manifest.samples) {
    await verifyFile({ root, physicalRoot, identity: sample.image });
  }

  const expected = new Set([
    lock.manifest.target.toLowerCase(),
    ...manifest.licenses.map((entry) => entry.target.toLowerCase()),
    ...manifest.samples.map((entry) => entry.image.target.toLowerCase()),
  ]);
  const actual = await listPackFiles(root);
  for (const target of actual) {
    if (!expected.has(target.toLowerCase())) throw corpusError("perception.corpus_unreferenced_file", target);
  }
  if (actual.length !== expected.size) throw corpusError("perception.corpus_file_inventory_mismatch");

  return Object.freeze({
    status: "verified",
    schemaVersion: 1,
    packId: manifest.packId,
    version: manifest.version,
    tier: manifest.tier,
    provenance: manifest.provenance,
    licenses: manifest.licenses,
    samples: manifest.samples,
  });
}

function validateCorpusLock(lock) {
  if (!isRecord(lock) || lock.schemaVersion !== 1) throw corpusError("perception.corpus_lock_schema_unsupported");
  const packId = requiredString(lock.packId, "perception.corpus_pack_id_required");
  const version = requiredString(lock.version, "perception.corpus_version_required");
  if (lock.identityStatus !== "locked") throw corpusError("perception.corpus_identity_pending");
  return Object.freeze({ schemaVersion: 1, packId, version, identityStatus: "locked", manifest: validateIdentity(lock.manifest, new Set()) });
}

function parseSample(sample, state) {
  if (!isRecord(sample)) throw corpusError("perception.corpus_sample_invalid");
  const id = requiredString(sample.id, "perception.corpus_sample_id_required");
  if (state.sampleIds.has(id)) throw corpusError("perception.corpus_sample_id_duplicate", id);
  state.sampleIds.add(id);
  const kind = requiredString(sample.kind, "perception.corpus_sample_kind_required");
  if (kind !== "ocr" && kind !== "visual") throw corpusError("perception.corpus_sample_kind_invalid", id);
  const applicationClass = requiredString(sample.applicationClass, "perception.corpus_application_class_required");
  if (!FULL_CORPUS_MINIMUMS.dpis.includes(sample.dpi)) throw corpusError("perception.corpus_dpi_invalid", id);
  if (!THEMES.has(sample.theme)) throw corpusError("perception.corpus_theme_invalid", id);
  const licenseId = requiredString(sample.licenseId, "perception.corpus_license_id_required");
  if (!state.licenseIds.has(licenseId)) throw corpusError("perception.corpus_license_unknown", id);
  const image = validateIdentity(sample.image, state.targets);
  const annotation = kind === "ocr" ? parseOcrAnnotation(sample.annotation) : parseVisualAnnotation(sample.annotation);
  return Object.freeze({ id, kind, applicationClass, dpi: sample.dpi, theme: sample.theme, licenseId, image, annotation });
}

function parseOcrAnnotation(annotation) {
  if (!isRecord(annotation)) throw corpusError("perception.corpus_ocr_annotation_invalid");
  const normalizedText = requiredString(annotation.normalizedText, "perception.corpus_ocr_text_required");
  if (!LANGUAGE_CLASSES.has(annotation.languageClass)) throw corpusError("perception.corpus_language_class_invalid");
  if (typeof annotation.criticalLabel !== "boolean") throw corpusError("perception.corpus_critical_label_invalid");
  return Object.freeze({
    normalizedText,
    languageClass: annotation.languageClass,
    criticalLabel: annotation.criticalLabel,
    region: parseBox(annotation.region),
  });
}

function parseVisualAnnotation(annotation) {
  if (!isRecord(annotation)) throw corpusError("perception.corpus_visual_annotation_invalid");
  const surfaceClass = requiredString(annotation.surfaceClass, "perception.corpus_surface_class_required");
  if (!Array.isArray(annotation.targets) || annotation.targets.length === 0 || !Array.isArray(annotation.ignored)) {
    throw corpusError("perception.corpus_visual_boxes_required");
  }
  const targets = annotation.targets.map((target) => {
    if (!isRecord(target) || typeof target.actionable !== "boolean") throw corpusError("perception.corpus_visual_target_invalid");
    return Object.freeze({
      box: parseBox(target.box),
      role: requiredString(target.role, "perception.corpus_visual_role_required"),
      label: requiredString(target.label, "perception.corpus_visual_label_required"),
      actionable: target.actionable,
    });
  });
  const ignored = annotation.ignored.map((entry) => {
    if (!isRecord(entry)) throw corpusError("perception.corpus_ignored_region_invalid");
    return Object.freeze({ box: parseBox(entry.box), reason: requiredString(entry.reason, "perception.corpus_ignored_reason_required") });
  });
  return Object.freeze({ surfaceClass, targets: Object.freeze(targets), ignored: Object.freeze(ignored) });
}

function validateFullInventory(samples) {
  const ocr = samples.filter((sample) => sample.kind === "ocr");
  const visual = samples.filter((sample) => sample.kind === "visual");
  if (ocr.length < FULL_CORPUS_MINIMUMS.ocr) throw corpusError("perception.corpus_ocr_insufficient");
  if (visual.length < FULL_CORPUS_MINIMUMS.visual) throw corpusError("perception.corpus_visual_insufficient");
  for (const [language, minimum] of Object.entries(FULL_CORPUS_MINIMUMS.ocrByLanguage)) {
    const count = ocr.filter((sample) => sample.annotation.languageClass === language).length;
    if (count < minimum) throw corpusError(`perception.corpus_ocr_${language}_insufficient`);
  }
  if (new Set(samples.map((sample) => sample.applicationClass)).size < FULL_CORPUS_MINIMUMS.applicationClasses) {
    throw corpusError("perception.corpus_application_classes_insufficient");
  }
  for (const dpi of FULL_CORPUS_MINIMUMS.dpis) {
    if (!samples.some((sample) => sample.dpi === dpi)) throw corpusError("perception.corpus_dpi_coverage_insufficient");
  }
  for (const theme of FULL_CORPUS_MINIMUMS.themes) {
    if (!samples.some((sample) => sample.theme === theme)) throw corpusError("perception.corpus_theme_coverage_insufficient");
  }
}

function validateIdentity(identity, targets) {
  if (!isRecord(identity)) throw corpusError("perception.corpus_identity_invalid");
  const target = requiredString(identity.target, "perception.corpus_target_required");
  if (isUnsafeTarget(target)) throw corpusError("perception.corpus_target_unsafe", target);
  const key = target.toLowerCase();
  if (targets.has(key)) throw corpusError("perception.corpus_target_duplicate", target);
  targets.add(key);
  if (!Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes <= 0 || !HASH_PATTERN.test(identity.sha256 ?? "")) {
    throw corpusError("perception.corpus_identity_invalid", target);
  }
  return Object.freeze({ target, sizeBytes: identity.sizeBytes, sha256: identity.sha256 });
}

function parseBox(box) {
  if (!isRecord(box)
    || !Number.isSafeInteger(box.x) || box.x < 0
    || !Number.isSafeInteger(box.y) || box.y < 0
    || !Number.isSafeInteger(box.width) || box.width <= 0
    || !Number.isSafeInteger(box.height) || box.height <= 0) {
    throw corpusError("perception.corpus_region_invalid");
  }
  return Object.freeze({ x: box.x, y: box.y, width: box.width, height: box.height });
}

async function verifyFile({ root, physicalRoot, identity }) {
  await assertNoLinkedPath(root, identity.target);
  const fullPath = joinTarget(root, identity.target);
  const stat = await lstat(fullPath).catch(() => null);
  if (!stat?.isFile()) throw corpusError("perception.corpus_file_missing", identity.target);
  const physicalPath = await realpath(fullPath).catch(() => null);
  if (!physicalPath || !isWithinRoot(physicalRoot, physicalPath)) throw corpusError("perception.corpus_path_escape", identity.target);
  if (stat.size !== identity.sizeBytes) throw corpusError("perception.corpus_size_mismatch", identity.target);
  if (await sha256File(fullPath) !== identity.sha256) throw corpusError("perception.corpus_hash_mismatch", identity.target);
}

async function assertNoLinkedPath(root, target) {
  let current = root;
  const segments = target === "" ? [] : target.split("/");
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat) throw corpusError("perception.corpus_pack_missing");
  if (rootStat.isSymbolicLink()) throw corpusError("perception.corpus_linked_path_forbidden");
  for (const segment of segments) {
    current = join(current, segment);
    const stat = await lstat(current).catch(() => null);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw corpusError("perception.corpus_linked_path_forbidden", target);
  }
}

async function listPackFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw corpusError("perception.corpus_linked_path_forbidden");
    if (entry.isDirectory()) files.push(...await listPackFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
    else throw corpusError("perception.corpus_entry_type_forbidden");
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function joinTarget(root, target) {
  return join(root, ...target.split("/"));
}

function isUnsafeTarget(target) {
  return target.includes("\\")
    || target.startsWith("/")
    || /^[A-Za-z]:/u.test(target)
    || target.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[\0\r\n]/u.test(target);
}

function isWithinRoot(root, candidate) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (process.platform === "win32") {
    return normalizedCandidate.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}${sep}`);
  }
  return normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function requiredString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw corpusError(code);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function corpusError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
