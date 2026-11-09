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

/**
 * What makes one Stage unable to run whatever Stages are around it: a name, and its kind's own
 * fields. A Stage template is checked with these alone; a Pipeline adds the rules about neighbours.
 */
export function singleStageProblems(stage: Stage): string[] {
  return [...nameProblems(stage, []), ...kindProblems(stage)];
}

function problemsOfStage(stage: Stage, earlierStages: readonly Stage[]): string[] {
  const problems = [
    ...keyProblems(stage, earlierStages),
    ...nameProblems(stage, earlierStages),
    ...kindProblems(stage),
  ];
  if (stage.kind === "agent") problems.push(...continueProblems(stage, earlierStages.at(-1)));
  if (stage.kind !== "gate" && stage.onFailure) {
    problems.push(...onFailureProblems(stage.onFailure, earlierStages));
  }
  return problems;
}

function keyProblems(stage: Stage, earlierStages: readonly Stage[]): string[] {
  return earlierStages.some((earlier) => earlier.key === stage.key)
    ? [`another Stage has the key "${stage.key}".`]
    : [];
}

function nameProblems(stage: Stage, earlierStages: readonly Stage[]): string[] {
  if (stage.name.trim() === "") return ["give it a name."];
  return earlierStages.some((earlier) => earlier.name === stage.name)
    ? [`another Stage is named "${stage.name}".`]
    : [];
}

function kindProblems(stage: Stage): string[] {
  const problems: string[] = [];
  if (stage.kind === "agent") {
    if (stage.role.trim() === "") problems.push("choose who works it.");
    if (!isPositiveWholeNumber(stage.budget)) {
      problems.push("its budget must be a whole number of tokens above 0.");
    }
  }
  if (stage.kind === "script" && stage.command !== "publish" && stage.publishTarget) {
    problems.push("only a Publish Stage has a publish target.");
  }
  if (stage.kind === "script" && stage.command !== "publish" && stage.afterConflict) {
    problems.push("only a Publish Stage says what follows a conflict.");
  }
  return problems;
}

function continueProblems(stage: AgentStage, previous: Stage | undefined): string[] {
  return stage.session === "continue" &&
    (previous?.kind !== "agent" || previous.role !== stage.role)
    ? ["continuing a session needs the same Role in the Stage before."]
    : [];
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
