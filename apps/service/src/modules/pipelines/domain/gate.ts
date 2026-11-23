import type { Stage } from "./stage.js";
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
 * The Task's last Gate run the user acted on: done, not skipped, with its Gate action. It ended as
 * the Task reached the Gate, so what the Gate showed is what was there by its `endedAt`.
 */
export function lastActedOnGateRun(runs: readonly StageRun[]): StageRun | undefined {
  return runs.findLast(
    ({ gateAction, outcome }) =>
      gateAction !== undefined && outcome?.status === "done" && outcome.skipped !== true,
  );
}

/**
 * The Stages a Gate may send the work back to (spec §2.3, the user's answer of 2026-10-26): any
 * Stage before it but a Gate, which would only wait again, and a Publish, whose work has already
 * left the workstation. An Agent Stage is briefed with the feedback; a Script Stage can't read it,
 * so it runs again and the walk goes on from there, the feedback kept on its run.
 */
export function sendBackTargets(stages: readonly Stage[], gateKey: string): Stage[] {
  const gateIndex = stages.findIndex(({ key }) => key === gateKey);
  return stages.slice(0, Math.max(gateIndex, 0)).filter(isSendBackTarget);
}

function isSendBackTarget(stage: Stage): boolean {
  return stage.kind !== "gate" && stage.kind !== "publish";
}

/**
 * Whether an Agent Stage comes after the Gate, to be briefed with the notes the user continues with
 * (spec §2.3): notes nobody reads are refused rather than kept to go nowhere.
 */
export function agentStageFollowsGate(stages: readonly Stage[], gateKey: string): boolean {
  const gateIndex = stages.findIndex(({ key }) => key === gateKey);
  return gateIndex >= 0 && stages.slice(gateIndex + 1).some(({ kind }) => kind === "agent");
}

/** Every reason the user can't do this at the Task's Gate now; empty when they can. */
export function gateActionProblems(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  action: GateAction,
): string[] {
  const waiting = waitingGateRun(stages, runs);
  if (!waiting) return ["The Task isn't waiting at a Gate."];
  if (action.kind === "continue") {
    const notesGoNowhere =
      action.feedback !== undefined && !agentStageFollowsGate(stages, waiting.stageKey);
    return notesGoNowhere
      ? ["No Agent Stage after the Gate reads your notes: continue without them."]
      : [];
  }
  if (action.kind !== "send-back") return [];
  const problems: string[] = [];
  if (!sendBackTargets(stages, waiting.stageKey).some(({ key }) => key === action.stageKey)) {
    problems.push("Send the work back to a Stage before the Gate, other than a Gate or a Publish.");
  }
  if (action.feedback.trim() === "") {
    problems.push("Say what should change before sending it back.");
  }
  return problems;
}
