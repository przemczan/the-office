import {
  countedTokens,
  type EngineSwitch,
  type GateAction,
  type PublishResult,
  type Role,
  type Stage,
  type StageRun,
  type TaskStage,
} from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { isRouteBack } from "../../shell/pipelines/flow/flow-model.ts";
import {
  PUBLISH_RESULT_NAMES,
  PUBLISH_TARGET_WORDS,
} from "../../shell/pipelines/pipeline-words.ts";
import { momentWords, shortDurationWords } from "../../shell/time.ts";
import { workingRoleKey } from "./stage-rail-words.ts";
import {
  budgetWords,
  gateActionWords,
  STAGE_STATE_WORDS,
  stageRule,
  WAITING_FOR_RUN_ENVIRONMENT,
  waitsForRunEnvironment,
  withoutMarkdownMarks,
  type StageNames,
} from "./stage-words.ts";

/** The words of a Stage's history: what the Stage is, and each of its runs. */

type CommandRun = StageRun["commandRuns"][number];

/** The tabs of an Agent run's details; the third only for a run whose Thread had any. */
export type RunTab = "summary" | "thread" | "sub-agents-and-processes";

const COMMAND_OUTCOME_WORDS: Readonly<Record<CommandRun["outcome"], string>> = {
  passed: "passed",
  failed: "failed",
  "could-not-run": "could not run",
  "timed-out": "timed out",
  stopped: "stopped",
};

const COMMAND_PURPOSE_WORDS: Readonly<Record<CommandRun["purpose"], string | undefined>> = {
  install: "install",
  command: undefined,
  "re-run": "re-run",
  "before-publishing": "before publishing",
  "after-publishing": "after publishing",
  condition: "condition",
};

/** The line under a Stage's name: its kind, its rule and what its runs came to. */
export function stageHistoryLine(
  taskStage: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
  names: StageNames,
): string {
  const { stage, runs, tokens } = taskStage;
  const spent = countedTokens(tokens);
  return [
    stageKindWords(taskStage, roles),
    ...stageRule(stage, names),
    spent > 0
      ? `${tokensShort(spent)} tokens over ${runs.length === 1 ? "1 run" : `${runs.length} runs`}`
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function stageKindWords(
  taskStage: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
): string {
  const { stage } = taskStage;
  if (stage.kind === "gate") return "Gate · waits for you";
  if (stage.kind === "script") return `Project command · ${stage.command}`;
  if (stage.kind === "publish") {
    return `Publish Stage · ${PUBLISH_TARGET_WORDS[stage.publishTarget ?? "publishing-mode"]}`;
  }
  const roleKey = workingRoleKey(taskStage);
  const role = roles?.find(({ key }) => key === roleKey);
  const who = role ? `${role.card.name} · ${role.card.title}` : "Nobody yet";
  return `Agent Stage · ${who} · budget ${tokensShort(stage.budget)} tokens`;
}

/** "14:02 → 14:20 · 18m", a run still going "14:02 → now · 18m so far". */
export function runTimeWords({ startedAt, endedAt }: StageRun, now: Date): string {
  const end = endedAt ? Date.parse(endedAt) : now.getTime();
  const taken = shortDurationWords(Math.max(0, end - Date.parse(startedAt)));
  const until = endedAt ? momentWords(endedAt, now) : "now";
  return `${momentWords(startedAt, now)} → ${until} · ${taken}${endedAt ? "" : " so far"}`;
}

type FailedOutcome = Extract<NonNullable<StageRun["outcome"]>, { status: "failed" }>;

/** How a Publish Stage's run's badge says each result (spec §2.3.4, "Publish's results"). */
const PUBLISH_RESULT_TONES: Readonly<Record<PublishResult, BadgeProps["tone"]>> = {
  published: "success",
  "nothing-to-publish": "neutral",
  conflict: "warning",
  "after-publishing-failed": "warning",
  failed: "danger",
};

function publishResultBadge(result: PublishResult): {
  readonly words: string;
  readonly tone: BadgeProps["tone"];
} {
  return { words: PUBLISH_RESULT_NAMES[result], tone: PUBLISH_RESULT_TONES[result] };
}

/**
 * How a run stands, as its badge says it: a Publish Stage's run by its result. The Stage's state
 * speaks for a run still going.
 */
export function runBadge(
  run: StageRun,
  state: TaskStage["state"],
): { readonly words: string; readonly tone: BadgeProps["tone"] } {
  const { outcome } = run;
  if (!outcome) {
    if (state === "running" && waitsForRunEnvironment(run)) {
      return { words: WAITING_FOR_RUN_ENVIRONMENT, tone: "info" };
    }
    return { words: STAGE_STATE_WORDS[state], tone: state === "running" ? "info" : "warning" };
  }
  switch (outcome.status) {
    case "done":
      if (outcome.skipped) return { words: STAGE_STATE_WORDS.skipped, tone: "neutral" };
      if (outcome.publishResult) return publishResultBadge(outcome.publishResult);
      return { words: STAGE_STATE_WORDS.done, tone: "success" };
    // The Decision may long be answered, so this says what the run came to, not what waits now.
    case "needs-decision":
      return { words: "Opened a Decision", tone: "warning" };
    case "failed":
      if (outcome.interrupted === "stop") {
        return { words: STAGE_STATE_WORDS.stopped, tone: "warning" };
      }
      if (
        outcome.interrupted === "pause" ||
        outcome.interrupted === "alarm" ||
        outcome.interrupted === "usage-window"
      ) {
        return { words: STAGE_STATE_WORDS.paused, tone: "warning" };
      }
      // No failure: the Stage went on with its edits (spec 2.4).
      if (outcome.interrupted === "restart") return { words: "Restarted", tone: "warning" };
      if (outcome.publishResult) return publishResultBadge(outcome.publishResult);
      return { words: STAGE_STATE_WORDS.failed, tone: "danger" };
  }
}

/** What a run came to, in Markdown. A Gate's run tells it by the user's action instead. */
export function runResultText({ stage, state }: TaskStage, run: StageRun): string | undefined {
  const { outcome } = run;
  if (!outcome) {
    if (stage.kind === "gate" && state === "waiting-on-you") {
      return "Waits for you to look at the changes and let the work continue.";
    }
    return stage.kind !== "gate" && state === "running" ? "Working now." : undefined;
  }
  switch (outcome.status) {
    case "done":
      if (outcome.skipped) return "The Definition of Done was already met.";
      if (stage.kind === "gate") return undefined;
      return outcome.summary === outcome.handoverNote ? undefined : outcome.summary;
    case "needs-decision":
      return outcome.question;
    case "failed":
      if (outcome.budgetReached) return `The Task ${budgetWords(outcome.budgetReached)}.`;
      if (outcome.interrupted === "usage-window" && outcome.refusedTurn) {
        return usageWindowHeldWords(outcome.refusedTurn);
      }
      return outcome.error;
  }
}

/**
 * A run held by a used-up usage window, its reset in local time (the service words it in UTC). One
 * whose session could go on on a Stand-in Engine but is over the size Settings › Engines asks first
 * above waits for the user's choice instead.
 */
function usageWindowHeldWords(
  { engineName, windowWords, resetsAt, standInChoice }: NonNullable<FailedOutcome["refusedTurn"]>,
  now: Date = new Date(),
): string {
  const held = `Paused: ${engineName}'s ${windowWords} is used up until ${momentWords(resetsAt, now)}. The engine refused the Agent's turn, which is no failure: the Stage's uncommitted edits stay in the worktree`;
  if (standInChoice) return `${held}. ${standInChoiceWords(standInChoice)}`;
  return `${held}, and it goes on by itself once the window resets.`;
}

type StandInChoice = NonNullable<NonNullable<FailedOutcome["refusedTurn"]>["standInChoice"]>;

/**
 * "Its context of 182,000 tokens is over the 100,000 set in Settings › Engines, so it waits for your
 * choice to go on on Claude Code 2, or the reset."
 */
function standInChoiceWords({ engineName, contextTokens, askAbove }: StandInChoice): string {
  return `Its context of ${contextTokens.toLocaleString("en-US")} tokens is over the ${askAbove.toLocaleString("en-US")} set in Settings › Engines, so it waits for your choice to go on on ${engineName}, or the reset.`;
}

/**
 * A run's session that went on on a Stand-in Engine, the reset in local time: "Claude Code's
 * 5-hour window was used up until 14:00, so the Stage went on on Claude Code 2", with ", as the
 * user Ann Lee chose" when the run waited for the user's choice.
 */
export function engineSwitchWords(
  { fromEngineName, toEngineName, windowWords, resetsAt, chosenBy }: EngineSwitch,
  now: Date = new Date(),
): string {
  const chosen = chosenBy ? `, as the user ${chosenBy.name} chose` : "";
  return `${fromEngineName}'s ${windowWords} was used up until ${momentWords(resetsAt, now)}, so the Stage went on on ${toEngineName}${chosen}`;
}

/** A run in the Stage history's list says what it came to in plain words, whatever else it holds. */
export function runGist(taskStage: TaskStage, run: StageRun, names: StageNames): string {
  const { gateAction, outcome } = run;
  const text =
    runResultText(taskStage, run) ??
    (gateAction ? gateChoiceWords(gateAction, names) : undefined) ??
    (outcome?.status === "done" ? outcome.summary : "");
  return text.split("\n").map(withoutMarkdownMarks).join(" ");
}

/** An ended run opens on what it handed on, a running one on its Thread. */
export function openingRunTab({ outcome }: StageRun): RunTab {
  return outcome === null ? "thread" : "summary";
}

/** Why a run's Thread has no composer: one whose Stage is held may still go on. */
export function runThreadClosedWords({ outcome }: StageRun): string {
  return outcome === null
    ? "This run isn't going on now, so its Thread takes no message."
    : "This run has ended, so its Thread is read-only.";
}

/** A run, wherever it stands in the Pipeline. */
export interface RunPlace {
  readonly stageKey: string;
  readonly runId: string;
}

/** The run that handed a note on: one Thread can hold several runs, even of different Stages. */
export function runOfHandoverNote(
  stages: readonly TaskStage[],
  threadId: string,
  note: string,
): RunPlace | undefined {
  for (const { stage, runs } of stages) {
    const run = runs.findLast(
      ({ threadId: runThreadId, outcome }) =>
        runThreadId === threadId && outcome?.handoverNote === note,
    );
    if (run) return { stageKey: stage.key, runId: run.id };
  }
  return undefined;
}

/** "Briefed with what failed in Tests, round 1 of 3", or "round 1" for a route with No limit. */
export function carriedFailureWords(
  { stageKey, round, rounds }: NonNullable<StageRun["carriedFailure"]>,
  names: StageNames,
): string {
  const of = rounds === null ? "" : ` of ${rounds}`;
  return `Briefed with what failed in ${names(stageKey)}, round ${round}${of}`;
}

/**
 * The route the walk left a run by, with its count (spec §2.3, "Which route the walk follows"):
 * "Went on to Review", "Went back to Implement (2 of at most 3)", "Went to End"; a route with No
 * limit counts only going back, "Went back to Implement (2 times)".
 */
export function routeFollowedWords(
  { to, times, limit }: NonNullable<StageRun["route"]>,
  fromKey: string,
  stages: readonly Stage[],
  names: StageNames,
): string {
  const back = isRouteBack(stages, fromKey, to);
  const count =
    limit !== null
      ? ` (${times} of at most ${limit})`
      : back
        ? ` (${times} ${times === 1 ? "time" : "times"})`
        : "";
  if (to === null) return `Went to End${count}`;
  return `${back ? "Went back to" : "Went on to"} ${names(to)}${count}`;
}

/**
 * The route an Agent chose with its reason (spec §2.3, "How an Agent chooses its route"): "Chose
 * Review: the change touches what the user sees".
 */
export function routeChoiceWords({ toName, reason }: NonNullable<StageRun["choice"]>): string {
  return `Chose ${toName}: ${reason.trim()}`;
}

/** "Restarted from Review by Ann Lee": the user's Restart from… on a held run. */
export function restartWords(
  { stageKey, by }: NonNullable<StageRun["restart"]>,
  names: StageNames,
): string {
  return `Restarted from ${names(stageKey)} by ${by}`;
}

/** "Started over by Ann Lee", with a reset: ", branch reset to main, old head kept as <ref>". */
export function startedOverWords({
  by,
  resetTo,
  keptRef,
}: NonNullable<StageRun["startedOver"]>): string {
  if (resetTo === null) return `Started over by ${by}`;
  const kept = keptRef === null ? "" : `, old head kept as ${keptRef}`;
  return `Started over by ${by}, branch reset to ${resetTo}${kept}`;
}

/** The divider before a Stage's runs of an earlier start, before the latest Start over. */
export const EARLIER_START_WORDS = "Earlier start";

/**
 * "You sent back to Implement": what the user did at a Gate's run; for a person's choice, "The
 * person in the Role cto, asked by Ann Lee, sent back to Implement".
 */
export function gateChoiceWords(action: GateAction, names: StageNames): string {
  const { person } = action;
  if (!person) return `You ${gateActionWords(action, names)}`;
  const allowed = person.allowedBy ? `, allowed by ${person.allowedBy}` : "";
  return `The person in the Role ${person.roleKey}, asked by ${person.askedBy}${allowed}, ${gateActionWords(action, names)}`;
}

/** How a command came out: "passed", "failed". */
export function commandMarkWords({ outcome }: CommandRun): string {
  return COMMAND_OUTCOME_WORDS[outcome];
}

/**
 * What it ran for, when that needs saying, and how long it took: "2m", "re-run · 2m", "condition
 * for the route to Review · 12s".
 */
export function commandTimeWords(
  { purpose, durationMs, condition }: CommandRun,
  names: StageNames,
): string {
  return [purposeWords(purpose, condition, names), shortDurationWords(durationMs)]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function purposeWords(
  purpose: CommandRun["purpose"],
  condition: CommandRun["condition"],
  names: StageNames,
): string | undefined {
  if (!condition) return COMMAND_PURPOSE_WORDS[purpose];
  const route = `the route to ${condition.to === null ? "End" : names(condition.to)}`;
  return purpose === "condition"
    ? `condition for ${route}`
    : `install for the condition of ${route}`;
}
