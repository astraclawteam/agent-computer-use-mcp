export function createPhase06Report({ doctor }) {
  const backendStep = {
    name: "Backend doctor",
    status: doctor.status === "healthy" ? "passed" : "blocked",
    detail: doctor,
  };

  if (doctor.status !== "healthy") {
    return {
      status: "blocked",
      steps: [
        backendStep,
        { name: "Computer Use Lab", status: "pending" },
        { name: "SOM capture", status: "pending" },
        { name: "Element action", status: "pending" },
      ],
      nextAction: "install or configure cua-driver, then rerun npm run phase:0.6",
    };
  }

  return {
    status: "ready",
    steps: [
      backendStep,
      { name: "Computer Use Lab", status: "pending" },
      { name: "SOM capture", status: "pending" },
      { name: "Element action", status: "pending" },
      { name: "Overlay observation exclusion", status: "pending" },
    ],
    nextAction: "open Computer Use Lab and run the cua-driver SOM capture/action sequence",
  };
}
