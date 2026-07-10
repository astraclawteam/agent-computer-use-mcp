import { runCuaDriverLiveAsset } from "../src/cua-driver-live-asset.mjs";

const report = await runCuaDriverLiveAsset();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "failed" ? 1 : 0;
