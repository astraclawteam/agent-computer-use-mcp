export function createPhase07Report({ doctor }) {
  const sidecarStep = {
    name: "OCR sidecar doctor",
    status: doctor.status === "healthy" ? "passed" : "blocked",
    detail: doctor,
  };

  if (doctor.status !== "healthy") {
    return {
      status: "blocked",
      steps: [
        sidecarStep,
        { name: "Canvas/self-drawn Lab fixture", status: "pending" },
        { name: "OCR capture", status: "pending" },
        { name: "OCR observation merge", status: "pending" },
      ],
      nextAction: "install local OCR sidecar dependencies, then rerun npm run phase:0.7",
    };
  }

  return {
    status: "ready",
    steps: [
      sidecarStep,
      { name: "Canvas/self-drawn Lab fixture", status: "pending" },
      { name: "OCR capture", status: "pending" },
      { name: "OCR observation merge", status: "pending" },
      { name: "Pixel-limited action marking", status: "pending" },
    ],
    nextAction: "run OCR capture against the canvas Lab fixture and merge OCR items into ComputerObservation",
  };
}
