import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { startGatewayManagedOverlay } from "./gateway-overlay-session.mjs";
import { runRealAppSmokeCatalog } from "./real-app-smoke-runner.mjs";

const catalog = JSON.parse(await readFile("docs/productization/real-app-smoke-catalog.json", "utf8"));
const report = await runRealAppSmokeCatalog({
  catalog: catalog.apps,
  startOverlay: () => startGatewayManagedOverlay(),
});
if (process.env.AGENT_COMPUTER_USE_REAL_APP_REPORT) {
  const reportPath = resolve(process.env.AGENT_COMPUTER_USE_REAL_APP_REPORT);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
