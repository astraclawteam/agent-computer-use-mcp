import { checkCuaDriverHealth } from "./driver-health.mjs";

const result = await checkCuaDriverHealth();
console.log(JSON.stringify(result, null, 2));

if (result.status !== "healthy") {
  process.exitCode = 2;
}
