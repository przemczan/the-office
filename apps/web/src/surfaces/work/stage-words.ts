import type {
  ContextMove,
  EngineStandIn,
  GateAction,
  Stage,
  StageRun,
  StageState,
  Task,
  TaskStage,
  TaskState,
  Thread,
  TokenTotals,
} from "@the-office/contracts";
import { tokensShort } from "../../shell/conversation/context-words.ts";
import { sumTokens } from "../../shell/token-words.ts";
import { isFailureRoute } from "../../shell/pipelines/flow/flow-model.ts";
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
  "not-taken": "Not taken",
  failed: "Failed",
};

/** A Script Stage's running run before its command starts, every run environment being in use. */
export const WAITING_FOR_RUN_ENVIRONMENT = "Waiting for a run environment";

/** Whether the run hasn't ended and waits for a free run environment, its command not started. */
export function waitsForRunEnvironment({ outcome, waitingSince }: StageRun): boolean {
  return outcome === null && waitingSince !== null;
}

/**
 * Where a Task's commands run while its Project's Run environment is Not decided yet and its branch
 * carries a valid definition: the Task head's note and a Script Stage run's log both say it.
 */
export const CARRIED_RUN_ENVIRONMENT =
  "Runs in this Task's run environment (its branch carries the definition)";

/** Whether any of the run's commands ran in the run environment the Task's branch carries. */
export function ranInCarriedRunEnvironment({ commandRuns }: StageRun): boolean {
  return commandRuns.some(({ inCarriedRunEnvironment }) => inCarriedRunEnvironment === true);
}

export const SESSION_WORDS: Readonly<Record<ContextMove, string>> = {
  resume: "continued session",
  fresh: "fresh session",
  "hand-off": "hand-off with a Brief",
};

/** The states of a started Task, whose run may work on Stand-in Engines. */
const STARTED: readonly TaskState[] = ["in-progress", "waiting-on-you", "paused"];

/** The Stand-in Engines the Task's run works on, none unless it is started. */
export function engineStandInsShown({
  state,
  engineStandIns,
}: Pick<Task, "state" | "engineStandIns">): readonly EngineStandIn[] {
  return STARTED.includes(state) ? engineStandIns : [];
}

/**
 * "On a Stand-in Engine: Personal for Work", several joined: the Task page's mark while its run
 * works on Stand-in Engines.
 */
export function engineStandInsWords(standIns: readonly EngineStandIn[]): string {
  const pairs = standIns.map(({ standInName, engineName }) => `${standInName} for ${engineName}`);
  return `On a Stand-in Engine: ${pairs.join(", ")}`;
}

/** Why each Stand-in Engine took over, one after the other, for the mark's hover. */
export function engineStandInsReasons(standIns: readonly EngineStandIn[]): string {
  return standIns.map(({ reason }) => reason).join(" ");
}

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

/**
 * "when it fails, goes to Implement, at most 3×": where a Stage's failure route, the ended-Failed
 * test on its own, leads; a Gate never fails.
 */
export function stageRule(stage: Stage, names: StageNames): string[] {
  const route = stage.kind === "gate" ? undefined : stage.routes?.find(isFailureRoute);
  if (!route) return [];
  const most = route.limit === null || route.limit === undefined ? "" : `, at most ${route.limit}×`;
  return [`when it fails, goes to ${route.to === null ? "End" : names(route.to)}${most}`];
}

/**
 * The pull request of the Task's newest Publish that shipped the work: one that ran to the end, or
 * one whose after publishing line failed once the work had shipped. A Publish going again doesn't
 * hide the one already open; undefined when that run kept none, as a run from before it was kept.
 */
export function pullRequestUrlOf(
  taskStages: readonly TaskStage[] | null | undefined,
): string | undefined {
  const newest = (taskStages ?? [])
    .filter(({ stage }) => stage.kind === "publish")
    .flatMap(({ runs }) => runs)
    .flatMap(({ number, outcome }) => {
      if (outcome?.status === "done" && !outcome.skipped) {
        return [{ number, pullRequestUrl: outcome.pullRequestUrl }];
      }
      if (outcome?.status === "failed" && outcome.afterPublishingFailed) {
        return [{ number, pullRequestUrl: outcome.afterPublishingFailed.pullRequestUrl }];
      }
      return [];
    })
    .toSorted((earlier, later) => earlier.number - later.number)
    .at(-1);
  return newest?.pullRequestUrl ?? undefined;
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
      return action.feedback === undefined ? "continued" : "continued, with notes";
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
