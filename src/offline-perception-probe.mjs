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
