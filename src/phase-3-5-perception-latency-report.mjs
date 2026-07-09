import { buildPerceptionLatencyReport } from "./perception-latency-report.mjs";

const report = buildPerceptionLatencyReport({
  samples: {
    smallUiCrop: [54, 67, 91, 118, 162],
    ordinaryWindowRegion: [138, 176, 221, 249, 292],
    fullWindowFirstRun: [884],
    fullWindowWarmDiagnostic: [430, 560, 640],
  },
  actionLoopFullWindowOcr: false,
  fullWindowProgressAware: true,
  cacheVerified: true,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.status === "passed" ? 0 : 1;
