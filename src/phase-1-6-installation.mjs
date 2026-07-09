import { getComputerUseInstallation } from "./computer-use-installation.mjs";

const installation = getComputerUseInstallation({
  client: process.argv.includes("--claude-desktop") ? "claude-desktop" : "codex",
  packageRoot: process.cwd(),
});

process.stdout.write(`${JSON.stringify({
  status: "passed",
  phase: "1.6",
  benchmark: "local-mcp-install-config",
  ...installation,
}, null, 2)}\n`);
