export const REQUIRED_PROTECTED_NPM_ENTRIES = Object.freeze([
  "package.json",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "release-integrity.json",
  "dist/launcher.mjs",
  "dist/computer-use-mcp-server.mjs",
  "dist/ocr-sidecar.mjs",
]);

const ALLOWED_ENTRIES = new Set(REQUIRED_PROTECTED_NPM_ENTRIES);
const SOURCE_ROOTS = [
  "src/",
  "test/",
  "scripts/",
  "gateway-overlay/",
  "native-lab/",
  "ocr-sidecar/",
];
const SOURCE_EXTENSIONS = [".cs", ".csproj", ".fs", ".fsproj", ".py", ".ts", ".tsx"];

export function validateProtectedNpmEntries(entries = []) {
  const normalizedEntries = entries.map(normalizeEntry);
  const violations = [];
  const seen = new Set();

  for (const path of normalizedEntries) {
    if (seen.has(path)) {
      violations.push({ code: "entry-duplicate", path });
      continue;
    }
    seen.add(path);

    if (path.endsWith(".map")) {
      violations.push({ code: "source-map-forbidden", path });
    } else if (isSourceEntry(path)) {
      violations.push({ code: "source-entry-forbidden", path });
    } else if (!ALLOWED_ENTRIES.has(path)) {
      violations.push({ code: "entry-not-allowlisted", path });
    }
  }

  for (const requiredPath of REQUIRED_PROTECTED_NPM_ENTRIES) {
    if (!seen.has(requiredPath)) {
      violations.push({ code: "required-entry-missing", path: requiredPath });
    }
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    entryCount: normalizedEntries.length,
    entries: normalizedEntries,
    violations,
  };
}

export function validateProtectedRuntime(options = {}) {
  const files = options.files ?? [];
  const protection = options.protection ?? {};
  const violations = [];

  requireProtectionValue(protection, "bundle", "esbuild@0.28.1", "bundle-profile-invalid", violations);
  requireProtectionValue(
    protection,
    "obfuscator",
    "javascript-obfuscator@5.4.6",
    "obfuscator-profile-invalid",
    violations,
  );
  requireProtectionValue(protection, "minify", true, "minify-disabled", violations);
  requireProtectionValue(protection, "sourceMap", false, "source-map-enabled", violations);
  requireProtectionValue(protection, "selfDefending", true, "self-defending-disabled", violations);
  requireProtectionValue(protection, "renameGlobals", false, "rename-globals-enabled", violations);
  requireProtectionValue(protection, "renameProperties", false, "rename-properties-enabled", violations);
  requireProtectionValue(
    protection,
    "controlFlowFlattening",
    false,
    "control-flow-flattening-enabled",
    violations,
  );
  requireProtectionValue(protection, "deadCodeInjection", false, "dead-code-injection-enabled", violations);
  requireProtectionValue(protection, "debugProtection", false, "debug-protection-enabled", violations);

  for (const file of files) {
    const path = normalizeEntry(file.path);
    const contents = String(file.contents ?? "");
    if (/sourceMappingURL|sourceURL\s*=/.test(contents)) {
      violations.push({ code: "source-map-reference", path });
    }
    if (path !== "dist/launcher.mjs" && hasFirstPartyRelativeImport(contents)) {
      violations.push({ code: "first-party-import-unbundled", path });
    }
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    fileCount: files.length,
    protection,
    violations,
  };
}

function normalizeEntry(entry) {
  return String(entry).replace(/\\/g, "/").replace(/^package\//, "").replace(/^\.\//, "");
}

function isSourceEntry(path) {
  return SOURCE_ROOTS.some((root) => path.startsWith(root))
    || SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function hasFirstPartyRelativeImport(contents) {
  return /(?:from\s*|import\s*\()\s*["']\.\.?\//.test(contents)
    || /import\s*["']\.\.?\//.test(contents);
}

function requireProtectionValue(protection, field, expected, code, violations) {
  if (protection[field] !== expected) {
    violations.push({ code, field, expected, actual: protection[field] });
  }
}
