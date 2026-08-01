import { BoundedLlmInteraction } from "./bounded-llm-interaction.mjs";
import { DeterministicMessagingStateMachine } from "./deterministic-messaging-state-machine.mjs";

/**
 * Host composition entry for Phase 5. The Host injects model completion and
 * retains the controller; the model produces only bounded semantic decisions.
 */
export async function runLlmBoundedMessagingWorkflow({
  host,
  complete,
  userGoal,
  decisionTimeoutMs,
  stepTimeouts,
  pollIntervalMs,
  signal,
} = {}) {
  const decisions = new BoundedLlmInteraction({
    complete,
    ...(decisionTimeoutMs === undefined ? {} : { timeoutMs: decisionTimeoutMs }),
  });
  const goal = await decisions.understandGoal({ userGoal, signal });
  const machine = new DeterministicMessagingStateMachine({
    host,
    goal,
    decisionPort: decisions,
    stepTimeouts,
    pollIntervalMs,
    signal,
  });
  return machine.run();
}
