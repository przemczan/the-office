import type { Role, Stage, TaskStage, TaskState } from "@the-office/contracts";
import { durationWords } from "../../shell/time.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { scriptCommandLine, STAGE_STATE_WORDS, timeTaken, type StageNames } from "./stage-words.ts";

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

/** The line over the rail: "At Tests: running", or how far the Task has come. */
export function railCaption(stages: readonly TaskStage[], taskState: TaskState): string {
  if (taskState === "done") return `All ${stages.length} Stages finished`;
  const current = currentStageIndex(stages);
  if (current < 0) return "Not started";
  const at = stages[current];
  if (at && HOLDING_STATES.includes(at.state)) {
    return `At ${at.stage.name}: ${STAGE_STATE_WORDS[at.state].toLowerCase()}`;
  }
  const finished = stages.filter(({ state }) => state === "done" || state === "skipped").length;
  return `${finished} of ${stages.length} Stages finished`;
}

/** Who works a Stage: its person, the user at a Gate, or its command once it has run it. */
export function stageWorkerWords(
  taskStage: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
): string {
  const { stage } = taskStage;
  if (stage.kind === "gate") return "You";
  if (stage.kind === "script") return scriptCommandLine(taskStage) ?? "Project command";
  return roles?.find(({ key }) => key === stage.role)?.card.name ?? "Nobody yet";
}

/** A Stage's state, saying where its failure sent the work. */
export function railStateWords({ state, wentBack }: TaskStage, names: StageNames): string {
  const words = STAGE_STATE_WORDS[state];
  return wentBack ? `${words} · went back to ${names(wentBack.stageKey)}` : words;
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
  if (runs.length === 0) return walkStarted ? "Not run yet" : "Not started";
  const count = runs.length === 1 ? "1 run" : `${runs.length} runs`;
  const time = durationWords(timeTaken(runs, now));
  return `${count} · ${time}${state === "running" ? " so far" : ""}`;
}

/** The trips back from a failing Stage to an earlier one, at its height among the rail's arcs. */
export interface LoopBack {
  readonly from: string;
  readonly to: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  /** How many times the work went back, which a resumed run doesn't add to. */
  readonly count: number;
  /** How many it may, with any rounds the user allowed since. */
  readonly rounds: number;
  /** Shorter loops sit under the longer ones they may span, from 0. */
  readonly level: number;
}

/**
 * The rail's loop-backs, from the runs' `carriedFailure`. A run counts as a trip when the failing
 * Stage ran just before it: a run resumed after a Decision or a Pause carries the same failure. A
 * Stage the user let run again in place goes nowhere to draw, and a Gate's send-back is no loop.
 */
export function loopBacks(stages: readonly TaskStage[]): readonly LoopBack[] {
  const runs = stages
    .flatMap(({ stage, runs: stageRuns }) => stageRuns.map((run) => ({ key: stage.key, run })))
    .toSorted((earlier, later) => earlier.run.number - later.run.number);
  const indexOf = (key: string): number => stages.findIndex(({ stage }) => stage.key === key);
  const loops = new Map<string, Omit<LoopBack, "level">>();
  runs.forEach(({ key: to, run: { carriedFailure } }, place) => {
    if (!carriedFailure || runs[place - 1]?.key !== carriedFailure.stageKey) return;
    const from = carriedFailure.stageKey;
    const [fromIndex, toIndex] = [indexOf(from), indexOf(to)];
    if (fromIndex <= toIndex) return;
    const count = (loops.get(`${from}>${to}`)?.count ?? 0) + 1;
    loops.set(`${from}>${to}`, {
      from,
      to,
      fromIndex,
      toIndex,
      count,
      rounds: carriedFailure.rounds,
    });
  });
  return [...loops.values()]
    .toSorted((one, other) => spanOf(one) - spanOf(other))
    .map((loop, level) => ({ ...loop, level }));
}

function spanOf({ fromIndex, toIndex }: Pick<LoopBack, "fromIndex" | "toIndex">): number {
  return fromIndex - toIndex;
}

/** What a loop-back's mark says in full. */
export function loopBackWords({ from, to, count, rounds }: LoopBack, names: StageNames): string {
  const times = count === 1 ? "1 time" : `${count} times`;
  return `${names(from)} failed and went back to ${names(to)} ${times}, of at most ${rounds}`;
}
