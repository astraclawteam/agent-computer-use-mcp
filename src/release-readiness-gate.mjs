import { readFileSync } from "node:fs";

export const ALPHA_RELEASE_COMMANDS = [
  "npm test",
  "npm run phase:0.10",
  "npm run phase:0.11",
  "npm run phase:0.12",
  "npm run phase:1.6",
  "npm run phase:1.7",
  "npm run phase:1.8",
  "npm run phase:1.9",
  "npm run phase:1.10",
  "npm run phase:1.11",
  "npm run phase:1.12",
  "npm run phase:2.0",
  "npm run phase:2.1",
  "npm run phase:2.2",
  "npm run phase:2.3",
  "npm run phase:2.4",
  "npm run phase:2.5",
  "npm run phase:2.6",
  "npm run phase:2.7",
  "npm run phase:2.8",
  "npm run phase:2.9",
  "npm run phase:2.10",
  "npm run phase:2.11",
  "npm run phase:3.0",
  "npm run phase:3.1",
  "npm run phase:3.2",
  "npm run phase:3.3",
  "npm run phase:3.4",
  "npm run phase:4.0",
  "npm run phase:4.1",
  "npm run phase:4.2",
  "npm run phase:4.3",
  "npm run phase:5.0",
  "npm run phase:5.1",
  "npm run phase:5.2",
  "npm run phase:5.3",
  "npm run phase:5.4",
  "npm run phase:5.5",
  "npm run phase:6.0",
  "npm run phase:6.1",
  "npm run phase:7.0",
  "npm run phase:7.1",
  "npm run phase:7.2",
  "npm run phase:7.3",
  "npm run phase:7.4",
  "npm run phase:1.4",
  "npm run package:foundation",
  "npm run package:dry-run",
  "npm run assets:manifest",
  "npm run doctor:install-cache",
];

export const REQUIRED_RELEASE_INVARIANTS = [
  {
    id: "overlay-excluded-from-observation",
    required: true,
    evidenceCommand: "npm run phase:4.3",
  },
  {
    id: "unknown-actions-fail-closed",
    required: true,
    evidenceCommand: "npm run phase:1.9",
  },
  {
    id: "secure-fields-fail-closed",
    required: true,
    evidenceCommand: "npm run phase:1.9",
  },
];

export const REQUIRED_RELEASE_EVIDENCE = [
  ["release-metadata-changelog", "npm run phase:0.10"],
  ["release-readiness-gate", "npm run phase:0.11"],
  ["release-artifact-verification", "npm run phase:0.12"],
  ["package-foundation", "npm run package:foundation"],
  ["package-dry-run", "npm run package:dry-run"],
  ["offline-asset-manifest", "npm run assets:manifest"],
  ["offline-install-cache-doctor", "npm run doctor:install-cache"],
  ["permission-policy-engine", "npm run phase:1.9"],
  ["controller-timeout-cleanup", "npm run phase:1.10"],
  ["policy-deny-proof", "npm run phase:1.11"],
  ["control-approval-state", "npm run phase:1.12"],
  ["diagnostics-policy", "npm run phase:2.3"],
  ["trace-writer-redaction", "npm run phase:2.4"],
  ["daemon-lifecycle", "npm run phase:2.6"],
  ["process-supervisor-recovery", "npm run phase:2.7"],
  ["repair-deny-state", "npm run phase:2.9"],
  ["daemon-session", "npm run phase:2.10"],
  ["daemon-session-doctor-repair", "npm run phase:2.11"],
  ["ocr-model-pack-manager", "npm run phase:3.0"],
  ["ocr-region-scheduler", "npm run phase:3.1"],
  ["template-matching-provider", "npm run phase:3.2"],
  ["som-proposal-provider", "npm run phase:3.3"],
  ["per-region-strategy-selector", "npm run phase:3.4"],
  ["commercial-overlay-placement", "npm run phase:4.0"],
  ["overlay-theme-cursor", "npm run phase:4.1"],
  ["overlay-target-tracker", "npm run phase:4.2"],
  ["overlay-exclusion-policy", "npm run phase:4.3"],
  ["mcp-concurrency", "npm run phase:5.0"],
  ["mcp-multi-client", "npm run phase:5.1"],
  ["mcp-disconnect-cleanup", "npm run phase:5.2"],
  ["strict-output-schemas", "npm run phase:5.3"],
  ["mcp-inspector-smoke", "npm run phase:5.4"],
  ["mcp-approval-compatibility", "npm run phase:5.5"],
  ["app-smoke-matrix", "npm run phase:6.0"],
  ["app-smoke-coverage", "npm run phase:6.1"],
  ["first-run-readiness", "npm run phase:7.0"],
  ["offline-bundle-readiness", "npm run phase:7.1"],
  ["repair-progress-plan", "npm run phase:7.2"],
  ["offline-capability-proof", "npm run phase:7.3"],
  ["offline-install-proof", "npm run phase:7.4"],
];

export function buildReleaseReadinessGate(options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const commands = ALPHA_RELEASE_COMMANDS.map((command, index) => ({
    id: commandId(command),
    order: index + 1,
    command,
    script: scriptForCommand(command),
    required: true,
    requiresDesktopControl: command === "npm run phase:1.4",
  }));

  const gate = {
    phase: "0.11",
    status: "passed",
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    releaseGate: "alpha",
    executionMode: "manifest-only",
    commands,
    evidence: REQUIRED_RELEASE_EVIDENCE.map(([id, command]) => ({
      id,
      command,
      required: true,
    })),
    invariants: REQUIRED_RELEASE_INVARIANTS,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };

  const validation = validateReleaseReadinessGate(gate, { packageJson });
  return {
    ...gate,
    status: validation.status,
    violations: validation.violations,
  };
}

export function validateReleaseReadinessGate(gate, options = {}) {
  const packageJson = options.packageJson ?? readPackageJson();
  const violations = [];
  const scripts = packageJson.scripts ?? {};
  for (const command of gate.commands ?? []) {
    if (!command.required) continue;
    const script = command.script ?? scriptForCommand(command.command);
    if (script && !scripts[script]) {
      violations.push({
        code: "missing-script",
        command: command.command,
        script,
      });
    }
  }

  for (const invariant of REQUIRED_RELEASE_INVARIANTS) {
    if (!gate.invariants?.some((candidate) => candidate.id === invariant.id && candidate.required === true)) {
      violations.push({
        code: "missing-invariant",
        id: invariant.id,
      });
    }
  }

  for (const [id, command] of REQUIRED_RELEASE_EVIDENCE) {
    if (!gate.evidence?.some((candidate) => candidate.id === id && candidate.command === command && candidate.required === true)) {
      violations.push({
        code: "missing-evidence",
        id,
        command,
      });
    }
  }

  if (gate.startsDesktopControl !== false) {
    violations.push({ code: "gate-starts-desktop-control" });
  }
  if (gate.includeUserOverlay !== false) {
    violations.push({ code: "gate-includes-user-overlay" });
  }

  return {
    status: violations.length === 0 ? "passed" : "failed",
    phase: "0.11",
    commandCount: gate.commands?.length ?? 0,
    evidenceCount: gate.evidence?.length ?? 0,
    invariantCount: gate.invariants?.length ?? 0,
    violations,
    includeUserOverlay: false,
    startsDesktopControl: false,
  };
}

function commandId(command) {
  return command
    .replace(/^npm /, "")
    .replace(/^run /, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function scriptForCommand(command) {
  if (command === "npm test") return "test";
  const match = /^npm run ([^ ]+)$/.exec(command);
  return match?.[1] ?? null;
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}
