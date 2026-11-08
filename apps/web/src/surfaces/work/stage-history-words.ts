import {
  countedTokens,
  type GateAction,
  type Role,
  type StageRun,
  type TaskStage,
} from "@the-office/contracts";
import type { BadgeProps } from "@the-office/ui";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { momentWords, shortDurationWords } from "../../shell/time.ts";
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

/** The tabs of an Agent run's details. */
export type RunTab = "summary" | "thread";

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
  { stage }: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
): string {
  if (stage.kind === "gate") return "Gate · waits for you";
  if (stage.kind === "script") return `Project command · ${stage.command}`;
  const role = roles?.find(({ key }) => key === stage.role);
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

/** How a run stands, as its badge says it. The Stage's state speaks for a run still going. */
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
      return outcome.skipped
        ? { words: STAGE_STATE_WORDS.skipped, tone: "neutral" }
        : { words: STAGE_STATE_WORDS.done, tone: "success" };
    // The Decision may long be answered, so this says what the run came to, not what waits now.
    case "needs-decision":
      return { words: "Opened a Decision", tone: "warning" };
    case "failed":
      if (outcome.interrupted === "stop") {
        return { words: STAGE_STATE_WORDS.stopped, tone: "warning" };
      }
      if (outcome.interrupted === "pause" || outcome.interrupted === "alarm") {
        return { words: STAGE_STATE_WORDS.paused, tone: "warning" };
      }
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
      return outcome.budgetReached
        ? `The Task ${budgetWords(outcome.budgetReached)}.`
        : outcome.error;
  }
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

/** "Briefed with what failed in Tests, round 1 of 3". */
export function carriedFailureWords(
  { stageKey, round, rounds }: NonNullable<StageRun["carriedFailure"]>,
  names: StageNames,
): string {
  return `Briefed with what failed in ${names(stageKey)}, round ${round} of ${rounds}`;
}

/** "You sent back to Implement": what the user did at a Gate's run. */
export function gateChoiceWords(action: GateAction, names: StageNames): string {
  return `You ${gateActionWords(action, names)}`;
}

/** How a command came out: "passed", "failed". */
export function commandMarkWords({ outcome }: CommandRun): string {
  return COMMAND_OUTCOME_WORDS[outcome];
}

/** What it ran for, when that needs saying, and how long it took: "2m", "re-run · 2m". */
export function commandTimeWords({ purpose, durationMs }: CommandRun): string {
  return [COMMAND_PURPOSE_WORDS[purpose], shortDurationWords(durationMs)]
    .filter((part) => part !== undefined)
    .join(" · ");
}
