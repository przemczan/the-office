import {
  addressableStatements,
  statementList,
  type UnmetOutOfReach,
  type WalkQuestion,
} from "./pipeline-walk.js";
import { isResolveStage } from "./resolve-stages.js";
import type { Stage } from "./stage.js";
import { tokensWords } from "./stage-budget.js";
import type {
  AgentRunDecision,
  BudgetReached,
  StageDecision,
  StageRun,
  StageRunDecision,
  WalkAnswer,
  WalkDecisionKind,
} from "./stage-run.js";

/**
 * How the user answers a Decision: one of its options, by its index, or in their own words.
 * `answeredBy` is the Consultant who answered in their place, by the key of their Role.
 */
export type DecisionAnswer = (
  | { readonly kind: "option"; readonly option: number }
  | { readonly kind: "free-answer"; readonly text: string }
) & { readonly answeredBy?: string };

/** A Decision the walk opens, worded for the user, with what each of its options does. */
export interface WalkDecision {
  readonly kind: WalkDecisionKind;
  readonly draft: StageDecision;
  /** What each of the draft's options does, in its order. */
  readonly options: readonly WalkAnswer[];
}

const CONTINUE_WITH_ISSUES = "Continue with the issues recorded";
const DROP_THE_TASK = "Drop the Task";
const MARK_DONE = "Mark the Task Done";
const GUIDANCE_HINT = "Or answer in your own words: your answer guides one more round.";

/**
 * The Decision for what the walk asks (spec §2.3), The Office's: when a Stage fails with no
 * retries left or reaches its budget, the Pipeline ends with the Definition of Done not reported
 * met, The Office restarted during a Stage, or a conflict at Publish is left to the user. The Agent
 * asks its own with an Office tool, never
 * through the walk. The user always may answer in their own words (`walkAnswerOf`).
 */
export function walkDecision(run: StageRun, question: WalkQuestion): WalkDecision {
  switch (question.kind) {
    case "no-retries-left":
      return noRetriesLeft(question.stage, question.error);
    case "budget":
      return budgetDecision(question.stage, question.reached);
    case "definition-of-done":
      return definitionOfDoneNotMet(question.unmet, question.outOfReach, question.again);
    case "restart":
      return restartDecision(question.stage, run);
    case "base-moved":
      return baseMovedDecision(question.stage, question.error);
    case "branch-moved":
      return branchMovedDecision(question.stage, question.error);
    case "after-publishing-failed":
      return afterPublishingFailedDecision(question.stage, question.error);
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
  if (decision.kind === "branch-moved")
    return { kind: "keep-branch", guidance: answer.text.trim() };
  const raise = decision.options.find(({ kind }) => kind === "raise-budget");
  if (decision.kind === "budget" && raise) return raise;
  return {
    kind: "one-more-round",
    guidance: answer.text.trim(),
    ...(answer.answeredBy !== undefined && { guidedBy: answer.answeredBy }),
  };
}

/**
 * Whether The Office puts what the walk asks to a Consultant before the user, whoever holds Asked
 * first when a Stage runs out of tries (spec §2.3): a Stage failing with no retries left, unless a
 * Consultant already sent that Stage back once in this walk; and
 * a Publish's after publishing line failing, the first time only, so a second failure reaches the
 * user. Every other question, budget limits included, is the user's.
 */
export function asksAConsultantFirst(question: WalkQuestion, runs: readonly StageRun[]): boolean {
  if (question.kind === "after-publishing-failed") {
    return !runs.some(
      ({ stageKey, decisions }) =>
        stageKey === question.stage.key &&
        decisions.some(({ kind }) => kind === "after-publishing-failed"),
    );
  }
  if (question.kind !== "no-retries-left") return false;
  return !runs.some(
    ({ stageKey, decisions }) =>
      stageKey === question.stage.key &&
      decisions.some(
        ({ kind, answer }) =>
          kind === "no-retries-left" &&
          answer?.kind === "one-more-round" &&
          answer.guidedBy !== undefined,
      ),
  );
}

/**
 * The Decision the Agent opened with an Office tool, as its run keeps it: each option answers its
 * question in the option's words.
 */
export function agentDecision(asked: StageDecision & { readonly id: string }): AgentRunDecision {
  return {
    id: asked.id,
    kind: "agent",
    question: asked.question,
    options: asked.options.map((option) => ({ kind: "answered", answer: option })),
    answer: undefined,
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
      context: `The budget counts the input, output and cache-write tokens of the Task's Threads so far, leaving out cache reads. Raising it to ${tokensWords(raised)} runs "${stage.name}" again; what it did so far is committed.`,
      options: [`Raise it to ${tokensWords(raised)}`, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason:
          "The work goes on from where it stopped; drop it only if the Task isn't worth more.",
      },
    },
    options: [{ kind: "raise-budget", tokens: raised - budget }, { kind: "drop" }],
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
  };
}

/** Another round can't help here: only the user knows what the move was (spec §2.3). */
function branchMovedDecision(stage: Stage, error: string): WalkDecision {
  return {
    kind: "branch-moved",
    draft: {
      question: `The Task's branch moved outside The Office, so "${stage.name}" didn't start. What now?`,
      context: `${error}\n\nOr answer in your own words: the branch stays as it is, and your answer guides the Stage.`,
      options: [
        "Keep the branch as it is",
        `I put the branch back: run "${stage.name}" again`,
        DROP_THE_TASK,
      ],
      recommendation: {
        option: 0,
        reason: "The Stage goes on from the branch as it is now, so nothing on it is lost.",
      },
    },
    options: [
      { kind: "keep-branch", guidance: undefined },
      { kind: "one-more-round", guidance: undefined },
      { kind: "drop" },
    ],
  };
}

/**
 * The work shipped, so going back can't help (spec §2.3 Loops): run the after line again, never
 * publishing again, or go on with the failure noted.
 */
function afterPublishingFailedDecision(stage: Stage, error: string): WalkDecision {
  return {
    kind: "after-publishing-failed",
    draft: {
      question: `"${stage.name}" published the work, but the Project's after publishing line failed. What now?`,
      context: `${error}\n\nThe work has shipped and the Task's worktree is kept. Retry runs only the after publishing line, never publishing again; Continue marks "${stage.name}" done with the failure noted, removes the worktree and goes on. Or answer in your own words: the after publishing line runs again.`,
      options: ["Retry the after publishing line", "Continue"],
      recommendation: {
        option: 0,
        reason: "Fix what the line needs, such as a Secret variable, then run it again.",
      },
    },
    options: [{ kind: "one-more-round", guidance: undefined }, { kind: "accept-issues" }],
  };
}

/** The run's error says what The Office discarded; words of the user's own go into the next run. */
function restartDecision(stage: Stage, { id, outcome }: StageRun): WalkDecision {
  if (outcome?.status !== "failed" || outcome.interrupted !== "restart") {
    throw new Error(`Stage run ${id} didn't end as The Office restarted.`);
  }
  if (outcome.notStarted) return notStartedDecision(stage);
  return {
    kind: "restart",
    draft: {
      question: `The Office restarted during "${stage.name}". Run it again?`,
      context: `${outcome.error}\n\nThe Office never runs a Stage again by itself after a restart. Or answer in your own words: your answer goes with the Stage as it runs again.`,
      options: [`Run "${stage.name}" again`, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "The Stage starts again from where the last Stage left the work.",
      },
    },
    options: [{ kind: "one-more-round", guidance: undefined }, { kind: "drop" }],
  };
}

function notStartedDecision(stage: Stage): WalkDecision {
  return {
    kind: "restart",
    draft: {
      question: `The Office restarted before "${stage.name}". Start it?`,
      context:
        "The Office stopped between Stages, so nothing of this one ran. It never starts a Stage by itself after a restart. Or answer in your own words: your answer goes with the Stage as it starts.",
      options: [`Start "${stage.name}"`, DROP_THE_TASK],
      recommendation: { option: 0, reason: "The work goes on from where the last Stage left it." },
    },
    options: [{ kind: "one-more-round", guidance: undefined }, { kind: "drop" }],
  };
}

/**
 * A conflict at Publish the user decides about (spec §2.3, "Conflicts at Publish"): after Resolve
 * gave up, or left a conflict that came back too often, they resolve it in the worktree, where The
 * Office left it, or drop the Task.
 */
function baseMovedDecision(stage: Stage, error: string): WalkDecision {
  if (!isResolveStage(stage)) return conflictWithNobodyToResolve(stage, error);
  return {
    kind: "base-moved",
    draft: {
      question: `"${stage.name}" couldn't resolve the Task's conflict with the base branch. What now?`,
      context: `${error}\n\nThe Office merged the base branch into the Task's branch and left the conflicted files in the Task's worktree. Resolve them there yourself, removing every conflict marker without committing, then choose the first option: The Office commits the merge and runs the Project's Test before Publish. Or answer in your own words: your answer guides one more round of "${stage.name}".`,
      options: ["I resolved it in the worktree", DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "The branch keeps the Task's work; it publishes once the conflict is resolved.",
      },
    },
    options: [{ kind: "resolved-in-worktree" }, { kind: "drop" }],
  };
}

/**
 * A Task with no Agent Stage has nobody to resolve a conflict at Publish: the user chooses to
 * publish again once the base no longer conflicts, finish without publishing, or drop the Task.
 */
function conflictWithNobodyToResolve(stage: Stage, error: string): WalkDecision {
  return {
    kind: "base-moved",
    draft: {
      question: `"${stage.name}" can't publish: the Task's branch conflicts with the base branch. What now?`,
      context: `${error}\n\nThe Task has no Agent Stage whose person could resolve the conflict, and no Agent can merge or rebase. "${stage.name}" can run again once the base branch no longer conflicts with the branch.`,
      options: [`Run "${stage.name}" again`, "Continue without publishing", DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "The branch keeps the Task's work; it publishes once the conflict is gone.",
      },
    },
    options: [
      { kind: "one-more-round", guidance: undefined },
      { kind: "accept-issues" },
      { kind: "drop" },
    ],
  };
}

/**
 * The Definition of Done not reported met: the statements `again` can address apart from those
 * Out of reach, which the user checks. With none to address, another round can't meet them, so
 * Mark it done is recommended.
 */
function definitionOfDoneNotMet(
  unmet: readonly string[],
  outOfReach: readonly UnmetOutOfReach[],
  again: Stage,
): WalkDecision {
  const addressable = addressableStatements(unmet, outOfReach);
  const context = notMetContext(unmet, addressable, outOfReach, again);
  const recommendation =
    addressable.length > 0
      ? {
          option: 0,
          reason:
            outOfReach.length === 0
              ? "What is left goes into its Brief, so the Agent can finish it."
              : "What it can address goes into its Brief, so the Agent can finish it; the rest is yours to check.",
        }
      : {
          option: 1,
          reason: `Another round of "${again.name}" can't meet them: check those statements yourself first, then mark it done.`,
        };
  return {
    kind: "definition-of-done",
    draft: {
      question: "The Pipeline ended, but the Definition of Done isn't reported met. What now?",
      context: `${context}\n\n${GUIDANCE_HINT}`,
      options: [`Run "${again.name}" once more`, MARK_DONE, DROP_THE_TASK],
      recommendation,
    },
    options: [
      { kind: "one-more-round", guidance: undefined },
      { kind: "mark-done" },
      { kind: "drop" },
    ],
  };
}

/** The unmet statements as one list, or apart: what `again` can address and what the user checks. */
function notMetContext(
  unmet: readonly string[],
  addressable: readonly string[],
  outOfReach: readonly UnmetOutOfReach[],
  again: Stage,
): string {
  if (outOfReach.length === 0) return `Not reported met:\n${statementList(unmet)}`;
  const unreachable = outOfReach.map(({ statement, why }) => `- ${statement} (${why})`).join("\n");
  const userChecks = `"${again.name}" can't verify these, so check them yourself:\n${unreachable}`;
  if (addressable.length === 0) return userChecks;
  return `"${again.name}" can address:\n${statementList(addressable)}\n\n${userChecks}`;
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
      ({ kind, answer }) =>
        (kind === "no-retries-left" ||
          kind === "base-moved" ||
          kind === "after-publishing-failed") &&
        answer?.kind === "accept-issues",
    );
    if (!accepted || outcome?.status !== "failed") return [];
    const stageName = stages.find(({ key }) => key === stageKey)?.name ?? stageKey;
    return [{ stageName, error: outcome.error }];
  });
}
