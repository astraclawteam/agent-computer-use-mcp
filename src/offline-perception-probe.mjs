import { OcrSidecarSession } from "./ocr-sidecar.mjs";
import { fusePerceptionProposals } from "./perception-proposal-fusion.mjs";
import { selectPerceptionStrategy } from "./perception-strategy-selector.mjs";
import { proposeSomFromImageFile } from "./som-proposal-provider.mjs";
import { normalizeRecognizedUiText } from "./ui-text-normalization.mjs";

export async function runOfflinePerceptionProbe(client, requestOptions) {
  const result = await client.callTool({
    name: "computer.health",
    arguments: { fast: false, prewarm: true },
  }, undefined, requestOptions);
  const health = result?.structuredContent;
  if (result?.isError
    || health?.status !== "ready"
    || health.ocr?.status !== "healthy"
    || health.ocr?.modelFormat !== "onnx"
    || health.ocr?.networkDisabled !== true
    || health.prewarm?.status !== "completed") {
    throw new Error("release.offline_ocr_not_verified");
  }
  return {
    ocrInitialized: true,
    networkDisabled: true,
    prewarmCompleted: true,
    modelFormat: health.ocr.modelFormat,
  };
}

export function createReleasedPerceptionProviders(options = {}) {
  let activeOcrSession = null;
  const sessionFactory = options.ocrSessionFactory ?? (() => new OcrSidecarSession({
    environment: options.environment ?? { ...process.env, AGENT_COMPUTER_USE_NETWORK_DISABLED: "1" },
  }));
  return Object.freeze({
    ocr: Object.freeze({
      async open() {
        const session = sessionFactory();
        await session.start();
        const doctor = await session.doctor();
        if (doctor.status !== "healthy" || doctor.modelFormat !== "onnx" || doctor.networkDisabled !== true) {
          await session.close().catch(() => {});
          throw providerError("release.offline_ocr_not_verified");
        }
        activeOcrSession = session;
        const identity = ocrIdentity(doctor);
        return Object.freeze({
          identity,
          async warmup(requests) {
            for (const request of requests) await recognize(session, request);
          },
          async recognize(request) {
            const response = await recognize(session, request);
            return {
              text: (response.items ?? []).map((item) => String(item.text ?? "")).join(" "),
              identity: ocrIdentity(response),
            };
          },
          async verifyCache(request) {
            const prime = await recognize(session, request, { noCache: false });
            const hit = await recognize(session, request, { noCache: false });
            return {
              cacheHit: hit.cacheHit === true,
              primeMs: Number(prime.timings?.totalMs ?? 0),
              hitMs: Number(hit.timings?.totalMs ?? 0),
            };
          },
          async close() {
            await session.close();
            if (activeOcrSession === session) activeOcrSession = null;
          },
        });
      },
    }),
    visual: Object.freeze({
      identity: Object.freeze({ provider: "local-proposal-fusion", model: "som-ocr-v1" }),
      async run(request) {
        if (!activeOcrSession) throw providerError("observation.insufficient");
        const surface = normalizeBenchmarkSurface(request.sample.annotation.surfaceClass);
        const strategy = selectPerceptionStrategy({
          capabilities: { ocr: false, template: false, somProposal: true, vlm: false },
          imagePath: request.imagePath,
          surface,
          window: { id: `corpus:${request.sampleId}` },
        });
        if (strategy.status !== "selected" || strategy.strategy !== "som-proposal") {
          throw providerError("observation.insufficient");
        }
        const somResult = await proposeSomFromImageFile({
          imagePath: request.imagePath,
          surface,
          minConfidence: options.somMinConfidence ?? 0.7,
        });
        const ocrResult = await recognize(activeOcrSession, request);
        const fusion = fusePerceptionProposals({
          template: [],
          som: (somResult.proposals ?? []).map((proposal) => ({
            provider: "som-proposal",
            proposalId: proposal.proposalId,
            box: proposal.bounds,
            confidence: proposal.confidence,
            role: proposal.role,
            label: proposal.label,
          })),
          ocr: (ocrResult.items ?? []).flatMap((item, index) => {
            const label = normalizeRecognizedUiText(String(item.text ?? ""), { languageClass: "mixed" });
            if (!label || !item.bounds) return [];
            return [{
              provider: "ocr",
              proposalId: `ocr-${index + 1}`,
              box: item.bounds,
              confidence: Number(item.confidence ?? 0),
              role: "text",
              label,
            }];
          }),
          ignored: request.sample.annotation.ignored ?? [],
        });
        return {
          proposals: fusion.proposals.map((proposal) => ({
            box: proposal.box,
            confidence: proposal.confidence,
            guessedAction: false,
            provider: proposal.source,
            proposalId: proposal.proposalId,
            label: proposal.label,
            support: proposal.support,
          })),
          observationProposals: fusion.observationProposals,
          identity: { provider: "local-proposal-fusion", model: "som-ocr-v1" },
        };
      },
    }),
  });
}

function recognize(session, request, options = {}) {
  return session.recognize({
    imagePath: request.imagePath,
    crop: request.sample.annotation.region,
    languages: request.sample.annotation.languageClass === "english" ? ["en"] : ["zh", "en"],
    noCache: options.noCache !== false,
    timeoutMs: 30_000,
  });
}

function ocrIdentity(value) {
  return Object.freeze({
    provider: String(value.provider),
    modelPack: String(value.modelPack),
    modelFormat: String(value.modelFormat),
    runtime: String(value.runtime),
    executionProvider: String(value.executionProvider),
  });
}

function normalizeBenchmarkSurface(surface) {
  if (surface === "cad-like") return "cad";
  if (surface === "editor" || surface === "canvas") return surface;
  return "self-drawn";
}

function providerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
