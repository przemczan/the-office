import type { WalkQuestion } from "./pipeline-walk.js";
import type { Stage } from "./stage.js";
import { tokensWords } from "./stage-budget.js";
import type {
  BudgetReached,
  StageDecision,
  StageDecisionKind,
  StageRun,
  StageRunDecision,
  WalkAnswer,
} from "./stage-run.js";

/** How the user answers a Decision: one of its options, by its index, or in their own words. */
export type DecisionAnswer =
  | { readonly kind: "option"; readonly option: number }
  | { readonly kind: "free-answer"; readonly text: string };

/** A Decision the walk opens, worded for the user, with what each of its options does. */
export interface WalkDecision {
  readonly kind: StageDecisionKind;
  readonly draft: StageDecision;
  /** What each of the draft's options does, in its order. */
  readonly options: readonly WalkAnswer[];
  /** The Office asks it, rather than the run's Agent (spec §9: The Office has no person). */
  readonly byTheOffice: boolean;
}

const CONTINUE_WITH_ISSUES = "Continue with the issues recorded";
const DROP_THE_TASK = "Drop the Task";
const MARK_DONE = "Mark the Task Done";
const GUIDANCE_HINT = "Or answer in your own words: your answer guides one more round.";

/**
 * The Decision for what the walk asks (spec §2.3): the Agent's own question as it asked it, or The
 * Office's, when a Stage fails with no retries left or the Pipeline ends with the Definition of
 * Done not reported met. The user always may answer in their own words (`walkAnswerOf`).
 */
export function walkDecision(run: StageRun, question: WalkQuestion): WalkDecision {
  switch (question.kind) {
    case "agent":
      return agentDecision(run);
    case "no-retries-left":
      return noRetriesLeft(question.stage, question.error);
    case "budget":
      return budgetDecision(question.stage, question.reached);
    case "definition-of-done":
      return definitionOfDoneNotMet(question.unmet, question.again);
  }
}

/**
 * What the user's answer lets the walk do: the chosen option's, or for words of their own, the
 * Agent's question answered, or one more round with their words as its guidance.
 */
export function walkAnswerOf(decision: StageRunDecision, answer: DecisionAnswer): WalkAnswer {
  if (answer.kind === "option") {
    const chosen = decision.options[answer.option];
    if (!chosen) throw new Error(`Decision ${decision.id} has no option ${answer.option}.`);
    return chosen;
  }
  if (decision.kind === "agent") return { kind: "answered", answer: answer.text.trim() };
  const raise = decision.options.find(({ kind }) => kind === "raise-budget");
  if (decision.kind === "budget" && raise) return raise;
  return { kind: "one-more-round", guidance: answer.text.trim() };
}

function agentDecision({ id, outcome }: StageRun): WalkDecision {
  if (outcome?.status !== "needs-decision") {
    throw new Error(`Stage run ${id} didn't end needing a Decision.`);
  }
  const { question, context, options, recommendation } = outcome;
  return {
    kind: "agent",
    draft: { question, context, options, recommendation },
    options: options.map((option) => ({ kind: "answered", answer: option })),
    byTheOffice: false,
  };
}

/** Raising gives the Stage its declared budget again (research §7), counted from the tokens used. */
function budgetDecision(stage: Stage, { used, budget }: BudgetReached): WalkDecision {
  const declared = stage.kind === "agent" ? stage.budget : 0;
  // From where the Task stands, so the raise always leaves the Stage its declared amount to use.
  const raised = Math.max(used, budget) + declared;
  const decision: WalkDecision = {
    kind: "budget",
    draft: {
      question: `"${stage.name}" reached its budget: the Task has used ${tokensWords(used)} tokens of ${tokensWords(budget)}. Raise it?`,
      context: `The budget counts every token of the Task's Threads so far, as each Thread shows them. Raising it to ${tokensWords(raised)} runs "${stage.name}" again; what it did so far is committed.`,
      options: [`Raise it to ${tokensWords(raised)}`, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason:
          "The work goes on from where it stopped; drop it only if the Task isn't worth more.",
      },
    },
    options: [{ kind: "raise-budget", tokens: raised - budget }, { kind: "drop" }],
    byTheOffice: true,
  };
  return decision;
}

function noRetriesLeft(stage: Stage, error: string): WalkDecision {
  const onFailure = stage.kind === "gate" ? undefined : stage.onFailure;
  const again = onFailure
    ? {
        words: `Allow ${moreRounds(onFailure.rounds)}`,
        answer: { kind: "more-rounds", rounds: onFailure.rounds } as const,
      }
    : {
        words: `Run "${stage.name}" once more`,
        answer: { kind: "one-more-round", guidance: undefined } as const,
      };
  const question = onFailure
    ? `"${stage.name}" failed, and its rounds are used up. What now?`
    : `"${stage.name}" failed, with no round to go back to. What now?`;
  return {
    kind: "no-retries-left",
    draft: {
      question,
      context: `${error}\n\n${GUIDANCE_HINT}`,
      options: [again.words, CONTINUE_WITH_ISSUES, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "Another round may fix it: the failure goes into its Brief.",
      },
    },
    options: [again.answer, { kind: "accept-issues" }, { kind: "drop" }],
    byTheOffice: true,
  };
}

function definitionOfDoneNotMet(unmet: readonly string[], again: Stage): WalkDecision {
  const statements = unmet.map((statement) => `- ${statement}`).join("\n");
  return {
    kind: "definition-of-done",
    draft: {
      question: "The Pipeline ended, but the Definition of Done isn't reported met. What now?",
      context: `Not reported met:\n${statements}\n\n${GUIDANCE_HINT}`,
      options: [`Run "${again.name}" once more`, MARK_DONE, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "What is left goes into its Brief, so the Agent can finish it.",
      },
    },
    options: [
      { kind: "one-more-round", guidance: undefined },
      { kind: "mark-done" },
      { kind: "drop" },
    ],
    byTheOffice: true,
  };
}

function moreRounds(rounds: number): string {
  return rounds === 1 ? "1 more round" : `${rounds} more rounds`;
}

/** A failure the user chose to continue with, which later commit messages name. */
export interface AcceptedIssue {
  readonly stageName: string;
  readonly error: string;
}

/** The failures the user chose to continue with, in the order they happened. */
export function acceptedIssues(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): AcceptedIssue[] {
  return runs.flatMap(({ stageKey, outcome, decisions }) => {
    const accepted = decisions.some(
      ({ kind, answer }) => kind === "no-retries-left" && answer?.kind === "accept-issues",
    );
    if (!accepted || outcome?.status !== "failed") return [];
    const stageName = stages.find(({ key }) => key === stageKey)?.name ?? stageKey;
    return [{ stageName, error: outcome.error }];
  });
}
