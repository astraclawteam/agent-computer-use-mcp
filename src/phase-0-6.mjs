import { CuaDriverBackend } from "./cua-driver-backend.mjs";
import { createPhase06Report } from "./phase-0-6-report.mjs";

const backend = new CuaDriverBackend();
const doctor = await backend.doctor();
const report = createPhase06Report({ doctor });

console.log(JSON.stringify(report, null, 2));

if (report.status !== "ready") {
  process.exitCode = 2;
}
