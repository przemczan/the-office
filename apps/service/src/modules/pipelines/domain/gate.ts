import type { AgentStage, Stage } from "./stage.js";
import type { GateAction, StageOutcome, StageRun } from "./stage-run.js";

/**
 * How a Gate's run ends as the Task reaches it: at once, so nothing is left running while the Task
 * waits for the user (a restart or a Pause finds no run to end); what the user does there is kept
 * on the run as its Gate action.
 */
export const GATE_REACHED: StageOutcome = {
  status: "done",
  summary: "The Task reached the Gate and waited for the user.",
};

/** The Task's latest run, when it is a Gate's that waits for the user. */
export function waitingGateRun(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): StageRun | undefined {
  const latest = runs.at(-1);
  if (!latest?.outcome || latest.gateAction) return undefined;
  const stage = stages.find(({ key }) => key === latest.stageKey);
  return stage?.kind === "gate" ? latest : undefined;
}

/**
 * The Stages a Gate may send the work back to: the Agent Stages before it, as only an Agent reads
 * the feedback.
 */
export function sendBackTargets(stages: readonly Stage[], gateKey: string): AgentStage[] {
  const gateIndex = stages.findIndex(({ key }) => key === gateKey);
  return stages
    .slice(0, Math.max(gateIndex, 0))
    .filter((stage): stage is AgentStage => stage.kind === "agent");
}

/** Every reason the user can't do this at the Task's Gate now; empty when they can. */
export function gateActionProblems(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  action: GateAction,
): string[] {
  const waiting = waitingGateRun(stages, runs);
  if (!waiting) return ["The Task isn't waiting at a Gate."];
  if (action.kind !== "send-back") return [];
  const problems: string[] = [];
  if (!sendBackTargets(stages, waiting.stageKey).some(({ key }) => key === action.stageKey)) {
    problems.push("Send the work back to an Agent Stage before the Gate.");
  }
  if (action.feedback.trim() === "") {
    problems.push("Say what should change before sending it back.");
  }
  return problems;
}
