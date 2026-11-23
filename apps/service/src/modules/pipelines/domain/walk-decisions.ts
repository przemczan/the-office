import {
  addressableStatements,
  RESTARTS_ASKED_AT,
  statementList,
  type UnmetOutOfReach,
  type WalkQuestion,
} from "./pipeline-walk.js";
import { routesWords } from "./proposed-routes.js";
import { isResolveStage } from "./resolve-stages.js";
import type { Route } from "./route.js";
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
 * How the user answers a Decision: one of its options, by its index, with the comments given
 * beside it as `guidance`, or in their own words. `answeredBy` is the Consultant who answered in
 * their place, by the key of their Role; an answer given for the user at their request is the
 * user's own, so it names nobody.
 */
export type DecisionAnswer = (
  | { readonly kind: "option"; readonly option: number; readonly guidance?: string }
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
const CALL_IT_MET = "Call it met and publish";
const GUIDANCE_HINT = "Or answer in your own words: your answer guides one more round.";

/**
 * The Decision for what the walk asks (spec §2.3), The Office's: when a Stage fails with no
 * retries left or reaches its budget, the Definition of Done isn't reported met before Publish or
 * as a Pipeline without one ends, The Office restarted during a Stage too often, a conflict at
 * Publish is left to the user, or no route out of an ended Stage holds. The Agent asks its own with an Office tool, never through the walk. The user always may answer in their own words (`walkAnswerOf`).
 */
export function walkDecision(run: StageRun, question: WalkQuestion): WalkDecision {
  switch (question.kind) {
    case "no-retries-left":
      return noRetriesLeft(question.stage, question.error, question.sendBackTo);
    case "budget":
      return budgetDecision(question.stage, question.reached);
    case "definition-of-done":
      return definitionOfDoneNotMet(question);
    case "restart":
      return restartDecision(question.stage, run);
    case "base-moved":
      return baseMovedDecision(question.stage, question.error);
    case "branch-moved":
      return branchMovedDecision(question.stage, question.error);
    case "after-publishing-failed":
      return afterPublishingFailedDecision(question.stage, question.error);
    case "no-route-holds":
      return noRouteHolds(question.stage, question.routes, question.why);
  }
}

/**
 * What the user's answer lets the walk do: the chosen option's, its comments guiding the round
 * when it is one more round or a send-back, keeps the branch or follows a route, or for words of
 * their own, the Agent's question answered, the first route followed with their words as its notes,
 * a failed Script Stage's work sent back to the last Agent Stage, or one more round, with their
 * words as its guidance (spec §2.3). The guidance names who gave it: the Consultant (`guidedBy`),
 * or the user when it names nobody.
 */
export function walkAnswerOf(decision: StageRunDecision, answer: DecisionAnswer): WalkAnswer {
  if (answer.kind === "option") {
    const chosen = decision.options[answer.option];
    if (!chosen) throw new Error(`Decision ${decision.id} has no option ${answer.option}.`);
    return withGuidance(chosen, answer);
  }
  const words = answer.text.trim();
  if (decision.kind === "agent") return { kind: "answered", answer: words };
  if (decision.kind === "branch-moved") return { kind: "keep-branch", guidance: words };
  const firstRoute = decision.options[0];
  if (decision.kind === "no-route-holds" && firstRoute?.kind === "follow-route") {
    return { ...firstRoute, guidance: words };
  }
  const raise = decision.options.find(({ kind }) => kind === "raise-budget");
  if (decision.kind === "budget" && raise) return raise;
  const guidedBy = answer.answeredBy === undefined ? {} : { guidedBy: answer.answeredBy };
  // Words on a failed Script Stage's Decision go to an Agent who reads them, never into a rerun.
  const sendBack = decision.options.find(({ kind }) => kind === "send-back");
  if (sendBack?.kind === "send-back") return { ...sendBack, guidance: words, ...guidedBy };
  return { kind: "one-more-round", guidance: words, ...guidedBy };
}

/** The chosen option, guided by the comments given beside it when it takes guidance. */
function withGuidance(
  chosen: WalkAnswer,
  answer: Extract<DecisionAnswer, { kind: "option" }>,
): WalkAnswer {
  const guidance = answer.guidance?.trim();
  if (!guidance) return chosen;
  if (chosen.kind === "keep-branch") return { kind: "keep-branch", guidance };
  if (chosen.kind === "follow-route") return { ...chosen, guidance };
  if (chosen.kind !== "one-more-round" && chosen.kind !== "send-back") return chosen;
  return {
    ...chosen,
    guidance,
    ...(answer.answeredBy !== undefined && { guidedBy: answer.answeredBy }),
  };
}

/**
 * Whether The Office puts what the walk asks to a Consultant before the user, whoever holds Asked
 * first when a Stage runs out of tries (spec §2.3): a Stage failing with no retries left, unless a
 * Consultant already gave that Stage one more round, or sent its work back, once in this walk; and
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
          (answer?.kind === "one-more-round" || answer?.kind === "send-back") &&
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

/**
 * A Stage failed with no retries left (spec §2.3, "When a Stage fails"): more rounds of its loop,
 * or of itself, continue with the issues, or drop the Task. A Script Stage's failure can also be
 * sent back to `sendBackTo`, the last Agent Stage the walk ran, which is recommended and takes the
 * words given, as rerunning the Script Stage with no change can't use them. The more rounds option
 * stays first, as an Off-board Task's Retry answers the first option.
 */
function noRetriesLeft(stage: Stage, error: string, sendBackTo: Stage | undefined): WalkDecision {
  const onFailure = stage.kind === "gate" ? undefined : stage.onFailure;
  const runAgain =
    stage.kind === "script" ? `Run "${stage.name}" again` : `Run "${stage.name}" once more`;
  const again = onFailure
    ? {
        words: `Allow ${moreRounds(onFailure.rounds)}`,
        answer: { kind: "more-rounds", rounds: onFailure.rounds } as const,
      }
    : { words: runAgain, answer: { kind: "one-more-round", guidance: undefined } as const };
  const question = onFailure
    ? `"${stage.name}" failed, and its rounds are used up. What now?`
    : `"${stage.name}" failed, with no round to go back to. What now?`;
  const rest = {
    words: [CONTINUE_WITH_ISSUES, DROP_THE_TASK],
    answers: [{ kind: "accept-issues" }, { kind: "drop" }] as const,
  };
  if (sendBackTo) {
    return {
      kind: "no-retries-left",
      draft: {
        question,
        context: `${error}\n\nOr answer in your own words: the work goes back to "${sendBackTo.name}" with them as its guidance.`,
        options: [again.words, `Send back to "${sendBackTo.name}" with these words`, ...rest.words],
        recommendation: {
          option: 1,
          reason: `"${sendBackTo.name}" can fix what failed: the failure and your words go into its Brief. Run it again only when the failure may be flaky.`,
        },
      },
      options: [
        again.answer,
        { kind: "send-back", to: sendBackTo.key, guidance: undefined },
        ...rest.answers,
      ],
    };
  }
  const context =
    stage.kind === "script"
      ? `${error}\n\nNo Agent Stage ran before "${stage.name}" in this walk, so the work can't be sent back to one. Words of your own run "${stage.name}" again, which no Agent reads.`
      : `${error}\n\n${GUIDANCE_HINT}`;
  return {
    kind: "no-retries-left",
    draft: {
      question,
      context,
      options: [again.words, ...rest.words],
      recommendation: {
        option: 0,
        reason:
          stage.kind === "script" && !onFailure
            ? "It may pass when it runs again, if the failure was flaky."
            : "Another round may fix it: the failure goes into its Brief.",
      },
    },
    options: [again.answer, ...rest.answers],
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
 * None of the routes out of the Stage holds, or one can't be weighed, as `why` says (spec §2.3,
 * "When no route holds"): the user follows one of them anyway, the first recommended as the
 * Pipeline puts it first, or drops the Task. Words of their own follow the first route and go with
 * the Stages after it, as a Gate's notes do.
 */
function noRouteHolds(
  stage: Stage,
  routes: readonly Route[],
  why: string | undefined,
): WalkDecision {
  const question =
    why === undefined
      ? `None of the routes out of "${stage.name}" holds. Where does the walk go on?`
      : `The Office can't weigh a route out of "${stage.name}": ${why} Where does the walk go on?`;
  return {
    kind: "no-route-holds",
    draft: {
      question,
      context: `"${stage.name}" goes ${routesWords(routes)}.\n\nOr answer in your own words: the walk follows the first route, and your answer goes with the Stages after it.`,
      options: [...routes.map(routeOptionWords), DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason: "It is the route the Pipeline weighs first.",
      },
    },
    options: [...routes.map(({ to }) => ({ kind: "follow-route", to }) as const), { kind: "drop" }],
  };
}

function routeOptionWords({ to, toName }: Route): string {
  return to === null ? "End the Pipeline here" : `Go on to ${toName ?? to}`;
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

/**
 * The `RESTARTS_ASKED_AT`th restart in a row during the Stage, which may be a crash loop, so The
 * Office stops going on by itself (spec §2.4); words of the user's own go into the next run.
 */
function restartDecision(stage: Stage, { id, outcome }: StageRun): WalkDecision {
  if (outcome?.status !== "failed" || outcome.interrupted !== "restart") {
    throw new Error(`Stage run ${id} didn't end as The Office restarted.`);
  }
  const times = RESTART_TIMES[RESTARTS_ASKED_AT] ?? `${RESTARTS_ASKED_AT} times`;
  return {
    kind: "restart",
    draft: {
      question: `The Office restarted ${times} in a row during "${stage.name}". Run it again?`,
      context: `${outcome.error}\n\nThe Office goes on by itself after a restart, but not after ${times} in a row during one Stage, in case the Stage itself makes it stop. Or answer in your own words: your answer goes with the Stage as it runs again.`,
      options: [`Run "${stage.name}" again`, DROP_THE_TASK],
      recommendation: {
        option: 0,
        reason:
          "The Stage goes on with the edits it kept, unless something keeps stopping The Office.",
      },
    },
    options: [{ kind: "one-more-round", guidance: undefined }, { kind: "drop" }],
  };
}

const RESTART_TIMES: Readonly<Record<number, string>> = { 2: "twice", 3: "three times" };

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
 * The Definition of Done not reported met, before Publish or at the end of a Pipeline without one:
 * the statements `again` can address apart from those Out of reach, which the user checks. With
 * none to address, another round can't meet them, so calling it met (or Done) is recommended.
 */
function definitionOfDoneNotMet({
  unmet,
  outOfReach,
  again,
  before,
}: Extract<WalkQuestion, { kind: "definition-of-done" }>): WalkDecision {
  const addressable = addressableStatements(unmet, outOfReach);
  const markDone = before ? CALL_IT_MET : MARK_DONE;
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
          reason: `Another round of "${again.name}" can't meet them: check those statements yourself first, then ${before ? "call it met" : "mark it done"}.`,
        };
  return {
    kind: "definition-of-done",
    draft: {
      question: before
        ? `The Stages before ${before.name} ended, but the Definition of Done isn't reported met. What now?`
        : "The Pipeline ended, but the Definition of Done isn't reported met. What now?",
      context: `${context}\n\n${GUIDANCE_HINT}`,
      options: [`Run "${again.name}" once more`, markDone, DROP_THE_TASK],
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
