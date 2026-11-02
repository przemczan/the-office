import type { AgentStage, OnFailure, Stage } from "./stage.js";

/** A named, ordered set of Stages that a Task's work follows: a straight list, never a branch. */
export interface Pipeline {
  readonly id: string;
  readonly name: string;
  /** When to choose it, in a sentence. */
  readonly description: string;
  readonly stages: readonly Stage[];
}

/** Why a list of Stages can't run, on the Stage it concerns when there is one. */
export interface StageProblem {
  readonly stageIndex?: number;
  readonly text: string;
}

/**
 * Every reason the Stages can't run, so an editor can flag them all at once; empty when they can.
 * Rules that need other modules (who fills a Role, and their Task limit) are checked where those
 * are known.
 */
export function stageProblems(stages: readonly Stage[]): readonly StageProblem[] {
  if (stages.length === 0) return [{ text: "A Pipeline needs at least one Stage." }];
  return stages.flatMap((stage, stageIndex) =>
    problemsOfStage(stage, stages.slice(0, stageIndex)).map((problem) =>
      problemOnStage(stage, stageIndex, problem),
    ),
  );
}

/** A problem with one Stage, worded so the editor's banner says which Stage it means. */
export function problemOnStage(stage: Stage, stageIndex: number, problem: string): StageProblem {
  return {
    stageIndex,
    text: `Stage ${stageIndex + 1} · ${stage.name.trim() || stage.key}: ${problem}`,
  };
}

function problemsOfStage(stage: Stage, earlierStages: readonly Stage[]): string[] {
  const problems = identityProblems(stage, earlierStages);
  if (stage.kind === "agent") problems.push(...agentStageProblems(stage, earlierStages.at(-1)));
  if (stage.kind === "script" && stage.command !== "publish" && stage.publishTarget) {
    problems.push("only a Publish Stage has a publish target.");
  }
  if (stage.kind !== "gate" && stage.onFailure) {
    problems.push(...onFailureProblems(stage.onFailure, earlierStages));
  }
  return problems;
}

function identityProblems(stage: Stage, earlierStages: readonly Stage[]): string[] {
  const problems: string[] = [];
  if (earlierStages.some((earlier) => earlier.key === stage.key)) {
    problems.push(`another Stage has the key "${stage.key}".`);
  }
  if (stage.name.trim() === "") problems.push("give it a name.");
  else if (earlierStages.some((earlier) => earlier.name === stage.name)) {
    problems.push(`another Stage is named "${stage.name}".`);
  }
  return problems;
}

function agentStageProblems(stage: AgentStage, previous: Stage | undefined): string[] {
  const problems: string[] = [];
  if (stage.role.trim() === "") problems.push("choose who works it.");
  if (!isPositiveWholeNumber(stage.budget)) {
    problems.push("its budget must be a whole number of tokens above 0.");
  }
  if (
    stage.session === "continue" &&
    (previous?.kind !== "agent" || previous.role !== stage.role)
  ) {
    problems.push("continuing a session needs the same Role in the Stage before.");
  }
  return problems;
}

function onFailureProblems(onFailure: OnFailure, earlierStages: readonly Stage[]): string[] {
  const problems: string[] = [];
  const target = earlierStages.find((earlier) => earlier.key === onFailure.goBackTo);
  if (!target) problems.push("on failure it can only go back to an earlier Stage.");
  else if (target.kind === "gate") problems.push("on failure it can't go back to a Gate.");
  if (!isPositiveWholeNumber(onFailure.rounds)) {
    problems.push("on failure it must go back a whole number of times, at least once.");
  }
  return problems;
}

function isPositiveWholeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
