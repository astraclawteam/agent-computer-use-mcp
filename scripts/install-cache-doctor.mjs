import { runInstallCacheDoctor } from "../src/install-cache-doctor.mjs";

const json = process.argv.includes("--json");
const report = await runInstallCacheDoctor();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`agent-computer-use install doctor: ${report.status}`);
  for (const asset of report.assets) {
    console.log(`- ${asset.id}: ${asset.status}`);
  }
  if (report.repairPlan.actions.length > 0) {
    console.log("repair actions:");
    for (const action of report.repairPlan.actions) {
      console.log(`- ${action.id}`);
    }
  }
}
