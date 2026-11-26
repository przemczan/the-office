import type { Role, Stage, TaskStage, TaskState } from "@the-office/contracts";
import { DUTY_LABELS } from "../../shell/duty-words.ts";
import { stageWorker } from "../../shell/pipelines/stage-edits.ts";
import { shortDurationWords } from "../../shell/time.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import type { PipelineProgress, ProgressStage } from "./pipeline-progress.ts";
import {
  scriptCommandLine,
  STAGE_STATE_WORDS,
  timeTaken,
  WAITING_FOR_RUN_ENVIRONMENT,
  waitsForRunEnvironment,
  type StageNames,
} from "./stage-words.ts";

/** The words of the Pipeline rail: where the Task is, and each Stage's person, state and runs. */

/** The states that hold the walk at a Stage, so the rail's "where it is" stops there. */
const HOLDING_STATES: readonly TaskStage["state"][] = [
  "running",
  "waiting-on-you",
  "failed",
  "paused",
  "stopped",
];

/**
 * What the rail draws: the Task's own Stages, or before it has its copy the library Pipeline's, as
 * Stages that haven't run. Empty once the library no longer has that Pipeline.
 */
export function stagesOnRail(
  own: readonly TaskStage[] | null,
  library: readonly Stage[] | undefined,
): readonly TaskStage[] {
  return (
    own ??
    (library ?? []).map((stage) => ({
      stage,
      state: "pending",
      tokens: NO_TOKENS,
      wentBack: null,
      runs: [],
    }))
  );
}

/** The Stage the walk has reached: the one holding it, else the last that ran; -1 before any ran. */
export function currentStageIndex(stages: readonly TaskStage[]): number {
  const holding = stages.findIndex(({ state }) => HOLDING_STATES.includes(state));
  return holding >= 0 ? holding : stages.findLastIndex(({ runs }) => runs.length > 0);
}

/** Whether the Stage the walk has reached was stopped, an earlier Stage's old Stop not counting. */
export function stoppedAtCurrentStage(stages: readonly TaskStage[]): boolean {
  return stages[currentStageIndex(stages)]?.state === "stopped";
}

/** Where the rail's scroller centres a Stage, its columns being equal shares of what it scrolls. */
export function railScrollLeft(
  stageIndex: number,
  stageCount: number,
  scrollWidth: number,
  clientWidth: number,
): number {
  return ((stageIndex + 0.5) * scrollWidth) / stageCount - clientWidth / 2;
}

/**
 * The line over the rail: "At Tests: running", or how far the Task has come. A Stage the walk's
 * path no longer reaches counts neither as finished nor among the Stages.
 */
export function railCaption(
  { stages, currentKey, started }: PipelineProgress,
  taskState: TaskState,
): string {
  const taken = stages.filter(({ taskStage }) => taskStage.state !== "not-taken");
  if (taskState === "done") return `All ${taken.length} Stages finished`;
  if (taskState === "planning") {
    return "Starts once you confirm the Plan, the Definition of Done and the Pipeline";
  }
  if (!started && currentKey === null) return "Not started";
  const at = stages.find(({ taskStage }) => taskStage.stage.key === currentKey)?.taskStage;
  if (at && HOLDING_STATES.includes(at.state)) {
    return `At ${at.stage.name}: ${stateWords(at).toLowerCase()}`;
  }
  const finished = taken.filter(
    ({ taskStage: { state } }) => state === "done" || state === "skipped",
  ).length;
  return `${finished} of ${taken.length} Stages finished`;
}

/**
 * A Stage's round, as its chip says it: "Round 2 of ≤3", "Round 2" with nothing bounding the rounds;
 * nothing for a Stage run once. `forScreenReader` spells "≤" out.
 */
export function roundWords(
  { rounds, roundBound }: Pick<ProgressStage, "rounds" | "roundBound">,
  forScreenReader = false,
): string {
  if (rounds < 2) return "";
  if (roundBound === null) return `Round ${rounds}`;
  return `Round ${rounds} of ${forScreenReader ? "at most " : "≤"}${roundBound}`;
}

/** Who works a Publish Stage: The Office, with its own git and credentials (spec §2.3.4). */
export const PUBLISH_WORKER = "The Office";

/**
 * Who works a Stage: its person, the user at a Gate, its command once it has run it, or The Office
 * at a Publish Stage. A Stage naming a duty shows `workedBy`'s person, or says nobody holds the duty.
 */
export function stageWorkerWords(
  taskStage: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
): string {
  const { stage } = taskStage;
  if (stage.kind === "gate") return "You";
  if (stage.kind === "script") return scriptCommandLine(taskStage) ?? "Project command";
  if (stage.kind === "publish") return PUBLISH_WORKER;
  const worker = stageWorker(stage);
  if (worker && "duty" in worker && !taskStage.workedBy) {
    const label = DUTY_LABELS[worker.duty];
    // Before the Task has its own Stages, the library's don't say who holds the duty.
    return taskStage.workedBy === null ? `${label} · nobody holds it` : label;
  }
  const roleKey = workingRoleKey(taskStage);
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? "Nobody yet";
}

/**
 * The key of the Role working an Agent Stage: the one it names, or for a duty `workedBy`; undefined
 * while nobody does, or for a Stage of another kind.
 */
export function workingRoleKey(taskStage: TaskStage): string | undefined {
  const worker = stageWorker(taskStage.stage);
  if (worker === undefined) return undefined;
  return "role" in worker ? worker.role : (taskStage.workedBy ?? undefined);
}

/**
 * Whether the Stage runs but its command hasn't started, waiting for a free run environment: no
 * live dot, as nothing works on it yet.
 */
export function stageWaitsForRunEnvironment({ state, runs }: TaskStage): boolean {
  const last = runs.at(-1);
  return state === "running" && last !== undefined && waitsForRunEnvironment(last);
}

/** A Stage's state, saying where its failure sent the work. */
export function railStateWords(taskStage: TaskStage, names: StageNames): string {
  const words = stateWords(taskStage);
  const { wentBack } = taskStage;
  return wentBack ? `${words} · went back to ${names(wentBack.stageKey)}` : words;
}

function stateWords(taskStage: TaskStage): string {
  return stageWaitsForRunEnvironment(taskStage)
    ? WAITING_FOR_RUN_ENVIRONMENT
    : STAGE_STATE_WORDS[taskStage.state];
}

/**
 * A Stage's runs and time, or why it has none; its tokens show beside this. `walkStarted` is
 * whether any Stage of the Task has run: a Task dropped before that still reads as not started.
 */
export function railRunsWords(
  { state, runs }: TaskStage,
  walkStarted: boolean,
  now: Date = new Date(),
): string {
  if (state === "skipped") return "Not needed";
  if (state === "not-taken") return "Not run";
  if (runs.length === 0) return walkStarted ? "Not run yet" : "Not started";
  const count = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  const time = shortDurationWords(timeTaken(runs, now));
  return `${count} · ${time}${state === "running" ? " so far" : ""}`;
}
