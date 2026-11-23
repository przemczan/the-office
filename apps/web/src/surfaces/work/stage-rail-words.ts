import type { Role, Stage, TaskStage, TaskState } from "@the-office/contracts";
import { DUTY_LABELS } from "../../shell/duty-words.ts";
import { stageWorker } from "../../shell/pipelines/stage-edits.ts";
import { shortDurationWords } from "../../shell/time.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
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
export function railCaption(stages: readonly TaskStage[], taskState: TaskState): string {
  const taken = stages.filter(({ state }) => state !== "not-taken");
  if (taskState === "done") return `All ${taken.length} Stages finished`;
  if (taskState === "planning") {
    return "Starts once you confirm the Plan, the Definition of Done and the Pipeline";
  }
  const current = currentStageIndex(stages);
  if (current < 0) return "Not started";
  const at = stages[current];
  if (at && HOLDING_STATES.includes(at.state)) {
    return `At ${at.stage.name}: ${stateWords(at).toLowerCase()}`;
  }
  const finished = taken.filter(({ state }) => state === "done" || state === "skipped").length;
  return `${finished} of ${taken.length} Stages finished`;
}

/**
 * Who works a Stage: its person, the user at a Gate, or its command once it has run it. A Stage
 * naming a duty shows `workedBy`'s person, or says nobody holds the duty.
 */
export function stageWorkerWords(
  taskStage: TaskStage,
  roles: readonly Pick<Role, "key" | "card">[] | undefined,
): string {
  const { stage } = taskStage;
  if (stage.kind === "gate") return "You";
  if (stage.kind === "script") return scriptCommandLine(taskStage) ?? "Project command";
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

/** The trips back from a failing Stage to an earlier one, at its height among the rail's arcs. */
export interface LoopBack {
  readonly from: string;
  readonly to: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  /** How many times the work went back, which a resumed run doesn't add to. */
  readonly count: number;
  /** How many it may, with any rounds the user allowed since; null for a route with No limit. */
  readonly rounds: number | null;
  /** The lowest height, from 0, free of the loops it overlaps; a shorter one sits under a longer. */
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
  return withLevels([...loops.values()]);
}

type RailSpan = Pick<LoopBack, "fromIndex" | "toIndex">;

/** Shortest first, so a loop that spans another is placed after it and goes over it. */
function withLevels(loops: readonly Omit<LoopBack, "level">[]): LoopBack[] {
  const placed: LoopBack[] = [];
  for (const loop of loops.toSorted((one, other) => spanOf(one) - spanOf(other))) {
    const taken = placed.filter((other) => overlap(loop, other)).map(({ level }) => level);
    let level = 0;
    while (taken.includes(level)) level += 1;
    placed.push({ ...loop, level });
  }
  return placed;
}

function spanOf({ fromIndex, toIndex }: RailSpan): number {
  return fromIndex - toIndex;
}

/** One leaving a Stage the other lands on doesn't overlap it: it goes up before the Stage's centre. */
function overlap(one: RailSpan, other: RailSpan): boolean {
  return one.toIndex < other.fromIndex && other.toIndex < one.fromIndex;
}

/** How far above a marker a loop-back's ends sit. */
const ARC_END_ABOVE_MARKER_PX = 2;

/** The lowest loop-back's height over its ends, and what each level above it adds. */
const ARC_HEIGHT_PX = 22;
const ARC_LEVEL_PX = 16;

/** Where a loop-back's ends sit from their Stages' centres, whatever its height. */
const ARC_LEAVES_BEFORE_PX = 4;
const ARC_LANDS_AFTER_PX = 6;

/**
 * A loop-back's square path over the rail: up from the failing Stage, across at its level's height
 * and down onto the Stage the work went back to. Its ends are shares of the rail's width, so it
 * needs no measuring; `top` and `height` are pixels from the rail's top, with the markers at
 * `markerTop`.
 */
export interface LoopBackPath {
  /** Where it goes up, from the rail's right: a little before the failing Stage's centre. */
  readonly leaves: RailPlace;
  /** Where it comes down, from the rail's left: a little after the earlier Stage's centre. */
  readonly landsOn: RailPlace;
  readonly top: number;
  readonly height: number;
}

/** A place across the rail: a share of its width, in percent, and pixels from there. */
export interface RailPlace {
  readonly share: number;
  readonly offset: number;
}

export function loopBackPath(
  { fromIndex, toIndex, level }: Pick<LoopBack, "fromIndex" | "toIndex" | "level">,
  stageCount: number,
  markerTop: number,
): LoopBackPath {
  const centreOf = (index: number): number => ((index + 0.5) * 100) / stageCount;
  const height = ARC_HEIGHT_PX + level * ARC_LEVEL_PX;
  return {
    leaves: { share: 100 - centreOf(fromIndex), offset: ARC_LEAVES_BEFORE_PX },
    landsOn: { share: centreOf(toIndex), offset: ARC_LANDS_AFTER_PX },
    top: markerTop - ARC_END_ABOVE_MARKER_PX - height,
    height,
  };
}

/** A line from a Stage up to the arcs there, shared by all that leave or land at that spot. */
export interface LoopBackEnd {
  readonly key: string;
  readonly kind: "leaves" | "lands";
  /** From the rail's right where it leaves, from its left where it lands, as in `LoopBackPath`. */
  readonly place: RailPlace;
  readonly top: number;
  readonly height: number;
}

/**
 * One line per spot, as high as the highest arc there. Each arc drawing its own would lay two dash
 * patterns on one line, which reads as solid or ragged.
 */
export function loopBackEnds(
  loops: readonly LoopBack[],
  stageCount: number,
  markerTop: number,
): LoopBackEnd[] {
  const ends = new Map<string, LoopBackEnd>();
  for (const loop of loops.toSorted((one, other) => one.level - other.level)) {
    const { leaves, landsOn, top, height } = loopBackPath(loop, stageCount, markerTop);
    const leaving = `leaves-${loop.fromIndex}`;
    const landing = `lands-${loop.toIndex}`;
    ends.set(leaving, { key: leaving, kind: "leaves", place: leaves, top, height });
    ends.set(landing, { key: landing, kind: "lands", place: landsOn, top, height });
  }
  return [...ends.values()];
}

/** What a loop-back's mark says in full. */
export function loopBackWords({ from, to, count, rounds }: LoopBack, names: StageNames): string {
  const times = count === 1 ? "1 time" : `${count} times`;
  const limit = rounds === null ? "" : `, of at most ${rounds}`;
  return `${names(from)} failed and went back to ${names(to)} ${times}${limit}`;
}
