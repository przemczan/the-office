import type { StageProblem } from "./pipeline.js";
import type { StageDecision } from "./stage-run.js";

/** The option indexes of `staffingDecision`, which the answer is read by. */
export const STAFFING_OPTIONS = { resume: 0, drop: 1 } as const;

/**
 * The Decision for a Task held because nobody can work its next Stages, such as after the person
 * who filled a Role was let go (spec §2.2). Resuming while the lack stands holds the Task again.
 */
export function staffingDecision(problems: readonly StageProblem[]): StageDecision {
  const lacks = problems.map(({ text }) => `- ${text}`).join("\n");
  return {
    question: "The Task is paused: nobody can work its next Stages. What now?",
    context: `${lacks}\n\nHire someone, or choose who works the Stage in Edit for this Task, then resume the Task. Resuming before that holds it again.`,
    options: ["Resume the Task", "Drop the Task"],
    recommendation: {
      option: STAFFING_OPTIONS.resume,
      reason: "The Task goes on from where it stopped once someone can work its Stages.",
    },
  };
}
