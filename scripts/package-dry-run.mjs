import { packProtectedNpmPackage } from "./pack-protected-npm-package.mjs";

const report = await packProtectedNpmPackage({ dryRun: true });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
