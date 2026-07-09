import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "ppu-ocv";
import { matchTemplateFile, normalizeTemplateMatches } from "./template-matching-provider.mjs";

const fixture = await createFixture();
const result = await matchTemplateFile({
  imagePath: fixture.screenshotPath,
  templates: [
    {
      id: "save-icon",
      label: "Save",
      role: "button",
      path: fixture.templatePath,
      threshold: 0.99,
    },
  ],
});
const observation = normalizeTemplateMatches(result, {
  observationId: "phase-3-2-template-observation",
  window: { title: "Template Fixture" },
});
const passed = result.status === "matched"
  && result.matches.length === 2
  && observation.elements.length === 2
  && observation.elements.every((element) => element.pixelLimitedAction)
  && result.includeUserOverlay === false
  && result.startsDesktopControl === false;

process.stdout.write(`${JSON.stringify({
  status: passed ? "passed" : "failed",
  phase: "3.2",
  benchmark: "template-matching-provider",
  provider: result.provider,
  matchCount: result.matches.length,
  observationElements: observation.elements.length,
  matches: result.matches.map((match) => ({
    templateId: match.templateId,
    label: match.label,
    role: match.role,
    score: match.score,
    bounds: match.bounds,
  })),
  includeUserOverlay: false,
  startsDesktopControl: false,
}, null, 2)}\n`);
process.exitCode = passed ? 0 : 1;

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-computer-use-phase-3-2-"));
  const screenshotPath = join(dir, "screenshot.png");
  const templatePath = join(dir, "save-template.png");

  const screenshot = createCanvas(80, 48);
  const ctx = screenshot.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 80, 48);
  drawSaveIcon(ctx, 12, 10);
  drawSaveIcon(ctx, 52, 28);
  await writeFile(screenshotPath, screenshot.toBuffer("image/png"));

  const template = createCanvas(8, 8);
  drawSaveIcon(template.getContext("2d"), 0, 0);
  await writeFile(templatePath, template.toBuffer("image/png"));

  return { screenshotPath, templatePath };
}

function drawSaveIcon(ctx, x, y) {
  ctx.fillStyle = "#ef6b4a";
  ctx.fillRect(x, y, 8, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 2, y + 1, 4, 2);
  ctx.fillStyle = "#7a2d20";
  ctx.fillRect(x + 2, y + 5, 4, 2);
}
