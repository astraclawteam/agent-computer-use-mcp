import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "ppu-ocv";
import { normalizeSomProposals, proposeSomFromImageFile } from "./som-proposal-provider.mjs";

const imagePath = await createFixture();
const result = await proposeSomFromImageFile({
  imagePath,
  surface: "canvas",
  minArea: 120,
});
const observation = normalizeSomProposals(result, {
  observationId: "phase-3-3-som-proposal-observation",
  window: { title: "Self Drawn Fixture" },
});
const passed = result.status === "proposed"
  && result.proposals.length === 2
  && observation.elements.length === 2
  && result.uploadsImage === false
  && result.includeUserOverlay === false
  && result.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "3.3",
  benchmark: "som-proposal-provider",
  provider: result.provider,
  surface: result.surface,
  proposalCount: result.proposals.length,
  observationElements: observation.elements.length,
  uploadsImage: result.uploadsImage,
  proposals: result.proposals.map((proposal) => ({
    role: proposal.role,
    confidence: proposal.confidence,
    bounds: proposal.bounds,
  })),
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-3-3-"));
  const imagePath = join(dir, "self-drawn.png");
  const canvas = createCanvas(96, 72);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 96, 72);
  ctx.fillStyle = "#262626";
  ctx.fillRect(14, 12, 34, 18);
  ctx.fillRect(12, 48, 70, 8);
  await writeFile(imagePath, canvas.toBuffer("image/png"));
  return imagePath;
}
