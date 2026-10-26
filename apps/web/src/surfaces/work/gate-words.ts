import type { Stage, TaskStage } from "@the-office/contracts";

/** The Gate a started Task waits at, with what Continue moves on to and where Send back may go. */
export interface WaitingGate {
  readonly gate: Stage;
  /** The Stage after the Gate; undefined when the Gate is the last. */
  readonly next: Stage | undefined;
  /** The Agent Stages before the Gate, as only an Agent reads the feedback; the last is the default. */
  readonly sendBackTargets: readonly Stage[];
  /** The Stages before the Gate that have run, whose results the Gate shows. */
  readonly earlier: readonly TaskStage[];
}

/** Undefined while the Task waits at no Gate. */
export function waitingGateOf(taskStages: readonly TaskStage[]): WaitingGate | undefined {
  // Acted on, a Gate may still wait on you for a Decision the walk opened on its run, such as the
  // Definition of Done's after Continue at the last Stage: that is the Decision's to answer.
  const index = taskStages.findIndex(
    ({ stage, state, runs }) =>
      stage.kind === "gate" && state === "waiting-on-you" && runs.at(-1)?.gateAction === null,
  );
  const waiting = taskStages[index];
  if (!waiting) return undefined;
  const before = taskStages.slice(0, index);
  return {
    gate: waiting.stage,
    next: taskStages[index + 1]?.stage,
    sendBackTargets: before.map(({ stage }) => stage).filter(({ kind }) => kind === "agent"),
    earlier: before.filter(({ state }) => state !== "pending"),
  };
}

/** "Continue to Publish" (prototypes/app/now.js), or "Continue" at the last Stage. */
export function continueLabel({ next }: WaitingGate): string {
  return next ? `Continue to ${next.name}` : "Continue";
}
