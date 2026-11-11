import type {
  ContextMove,
  GateAction,
  Stage,
  StageRun,
  StageState,
  TaskStage,
  Thread,
  TokenTotals,
} from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { sumTokens } from "../../shell/token-words.ts";
import { STOPPED } from "../../shell/work/work-words.ts";

/** The words of a Task's Stages that the rail and the Stage history share. */

export const STAGE_STATE_WORDS: Readonly<Record<StageState, string>> = {
  pending: "Pending",
  running: "Running",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  stopped: STOPPED,
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

/** A Script Stage's running run before its command starts, every run environment being in use. */
export const WAITING_FOR_RUN_ENVIRONMENT = "Waiting for a run environment";

/** Whether the run hasn't ended and waits for a free run environment, its command not started. */
export function waitsForRunEnvironment({ outcome, waitingSince }: StageRun): boolean {
  return outcome === null && waitingSince !== null;
}

export const SESSION_WORDS: Readonly<Record<ContextMove, string>> = {
  resume: "continued session",
  fresh: "fresh session",
  "hand-off": "hand-off with a Brief",
};

/** Names a Stage by its key, as the Stages it is among call it. */
export type StageNames = (key: string) => string;

/**
 * A Task's Pipeline once the library no longer has it: a running or done Task keeps the copy of
 * the Stages it started with, so it may name a Pipeline removed since.
 */
export const REMOVED_PIPELINE = "removed from the library";

/** A Task's Pipeline before one is chosen: the Planner proposes one, or the user chooses one. */
export const PIPELINE_NOT_CHOSEN = "Not chosen yet";

/** The placeholder rail's element, for Before Ready's link to it. */
export const PIPELINE_RAIL_ELEMENT_ID = "task-pipeline-rail";

/** What the placeholder rail of a Task with no Pipeline says. */
export const PIPELINE_NOT_CHOSEN_WORDS =
  "Pipeline not chosen yet. The Planner proposes one while planning.";

/** The Task's Pipeline as the rail names it, saying when it was edited for the Task. */
export function pipelineLabel(pipelineName: string, editedForTask: boolean): string {
  return editedForTask ? `${pipelineName} · edited for this Task` : pipelineName;
}

export function stageNamesOf(stages: readonly Stage[]): StageNames {
  return (key) => stages.find((stage) => stage.key === key)?.name ?? key;
}

/** "Optional · on failure back to Implement, at most 3×": what a Stage not yet run will do. */
export function stageRule(stage: Stage, names: StageNames): string[] {
  const onFailure = stage.kind !== "gate" ? stage.onFailure : undefined;
  return [
    stage.optional ? "optional" : undefined,
    onFailure && `on failure back to ${names(onFailure.goBackTo)}, at most ${onFailure.rounds}×`,
  ].filter((part) => part !== undefined);
}

/**
 * The pull request of the Task's newest Publish that ran to the end. A Publish going again doesn't
 * hide the one already open; undefined when that run kept none, as a run from before it was kept.
 */
export function pullRequestUrlOf(
  taskStages: readonly TaskStage[] | null | undefined,
): string | undefined {
  const newest = (taskStages ?? [])
    .filter(({ stage }) => stage.kind === "script" && stage.command === "publish")
    .flatMap(({ runs }) => runs)
    .flatMap(({ number, outcome }) =>
      outcome?.status === "done" && !outcome.skipped ? [{ number, outcome }] : [],
    )
    .toSorted((earlier, later) => earlier.number - later.number)
    .at(-1);
  return newest?.outcome.pullRequestUrl ?? undefined;
}

/** The command line a Script Stage ran, as the Project names it, once it has run it. */
export function scriptCommandLine({ runs }: TaskStage): string | undefined {
  return runs
    .flatMap(({ commandRuns }) => commandRuns)
    .findLast(({ purpose }) => purpose === "command")?.commandLine;
}

/** Every run's time, a running one's until now. */
export function timeTaken(runs: readonly StageRun[], now: Date): number {
  return runs.reduce((sum, run) => {
    const end = run.endedAt ? Date.parse(run.endedAt) : now.getTime();
    return sum + Math.max(0, end - Date.parse(run.startedAt));
  }, 0);
}

/** "reached its budget: 120k of 100k tokens". */
export function budgetWords({
  used,
  budget,
}: {
  readonly used: number;
  readonly budget: number;
}): string {
  return `reached its budget: ${tokensShort(used)} of ${tokensShort(budget)} tokens`;
}

/** What the user did at a Gate, as its Stage history says it. */
export function gateActionWords(action: GateAction, names: StageNames): string {
  switch (action.kind) {
    case "continue":
      return "continued";
    case "send-back":
      return `sent back to ${names(action.stageKey)}`;
    case "drop":
      return "dropped the Task";
  }
}

/** A result's first line, its Markdown code spans as plain words, for a plain-text tooltip. */
export function firstLine(text: string): string {
  return plain(headLine(text));
}

/** A line of Markdown as plain words: no list or heading mark, no bold, no code spans. */
export function withoutMarkdownMarks(line: string): string {
  return plain(line)
    .replace(/^\s*(?:#+|[-*+]|\d+\.)\s+/, "")
    .replace(/\*\*|__/g, "");
}

/** A result's first line, still in Markdown. */
function headLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}

/** The Office writes commands in Markdown code spans; the line shows them as plain words. */
function plain(text: string): string {
  return text.replaceAll("`", "");
}

/**
 * The Task's tokens: those of every Thread on it, by kind. They include a running turn's tokens so
 * far, so they move mid-turn.
 */
export function taskTokens(threads: readonly Pick<Thread, "tokens">[] | undefined): TokenTotals {
  return sumTokens((threads ?? []).map(({ tokens }) => tokens));
}
