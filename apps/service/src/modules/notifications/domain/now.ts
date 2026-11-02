import type { TokenKinds } from "./office-day.js";
import { latestPerTask, type TaskOutcome, type TaskOutcomeKind } from "./task-outcome.js";

/** A Task as Now shows it, from Work. */
export interface OfficeTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
  /** Whether the fire alarm holds it Paused, apart from the user's own Pause. */
  readonly pausedByAlarm: boolean;
}

/** The fire alarm, from Work: off, or on since it was sounded. */
export type NowFireAlarm = { readonly on: false } | { readonly on: true; readonly since: Date };

/** How a Task the fire alarm paused would go on at the all clear (spec §2.8), from Pipelines. */
export interface TaskResume {
  readonly kind:
    | "continues-warm"
    | "re-caches"
    | "fresh"
    | "script"
    | "publish-finished"
    | "waits-on-you"
    | "goes-on";
  readonly stageName: string | undefined;
  readonly contextTokens: number;
  readonly briefTokens: number;
  /** What resuming costs, in tokens, before work continues. */
  readonly tokens: number;
}

/** A Decision that waits on the user, from Conversations. */
export interface OpenDecision {
  readonly id: string;
  readonly taskId: string;
  readonly askedAt: Date;
}

/** One of a started Task's Stages with where it stands and its runs, oldest first, from Pipelines. */
export interface StageOfTask {
  readonly stage: {
    readonly key: string;
    readonly name: string;
    readonly kind: string;
    /** The Role whose person works an Agent Stage; other kinds have none. */
    readonly role?: string;
  };
  readonly state: string;
  readonly runs: readonly { readonly startedAt: Date; readonly endedAt: Date | undefined }[];
}

/** An account's 5-hour window, from the Engine. */
export interface FiveHourWindow {
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
}

/** One engine's account's 5-hour window. */
export interface EngineFiveHourWindow extends FiveHourWindow {
  readonly engineId: string;
}

export interface WaitingDecision {
  readonly kind: "decision";
  readonly decisionId: string;
  readonly taskId: string;
  /** The Task's, so the Project filter can narrow what waits. */
  readonly projectId: string;
  readonly waitingSince: Date;
}

export interface WaitingGate {
  readonly kind: "gate";
  readonly taskId: string;
  readonly projectId: string;
  readonly stageKey: string;
  readonly waitingSince: Date;
}

/** What waits on the user. A message from a person joins with tier 2 (the user's answer of 2026-10-27). */
export type NeedsYouItem = WaitingDecision | WaitingGate;

/** The Stage a started Task is at: the one with its latest run. */
export interface CurrentStage {
  readonly key: string;
  readonly name: string;
  readonly role: string | undefined;
  /** When the Stage's latest run started: time in Stage counts from here. */
  readonly since: Date;
}

/** A started Task at its desk: In progress, Waiting on you or Paused. */
export interface RunningTask {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
  /** Undefined before its first Stage run. */
  readonly stage: CurrentStage | undefined;
}

export interface FinishedTask {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly outcome: TaskOutcomeKind;
  readonly occurredAt: Date;
}

/** A Task in Work's queue for Start, with the waits that hold it, from Work. */
export interface QueuedOnNow {
  readonly taskId: string;
  readonly reasons: readonly string[];
}

/** A queued Task as Now shows it: its place, counted from 1, and why it waits. */
export interface QueuedTask {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly place: number;
  readonly reasons: readonly string[];
}

/** A Task the fire alarm paused, with how it would go on at the all clear. */
export interface AlarmPausedTask {
  readonly taskId: string;
  readonly title: string;
  readonly projectId: string;
  readonly stage: CurrentStage | undefined;
  /** Undefined while its Stage is still stopping at its safe point. */
  readonly resume: TaskResume | undefined;
}

/**
 * The fire alarm while it is on (spec §2.8): stopping until every Stage it holds has reached its
 * safe point, then the plan the all clear follows, each Task resuming unless the user holds or
 * drops it.
 */
export interface FireAlarmOnNow {
  readonly since: Date;
  readonly stopping: boolean;
  /** Each Task it paused, in the order Now runs them. */
  readonly paused: readonly AlarmPausedTask[];
  /** What resuming every one of them costs, in tokens. */
  readonly resumeTokens: number;
}

/** The running Tasks against the Office-wide limit (spec §2.2 Defaults). */
export interface Desks {
  readonly inUse: number;
  readonly limit: number;
}

/** Now and the status strip (spec §4): what needs the user, what runs, and the Office's figures. */
export interface Now {
  /** Oldest first. */
  readonly needsYou: readonly NeedsYouItem[];
  readonly running: readonly RunningTask[];
  /** The queue for Start, first place first (spec §2.1, "A queue for Start"). */
  readonly queue: readonly QueuedTask[];
  /** Undefined until the user is first seen. */
  readonly leftAt: Date | undefined;
  /** Each Task's latest outcome since the user left, latest first. */
  readonly sinceYouLeft: readonly FinishedTask[];
  readonly tokensToday: TokenKinds;
  /** The Tasks with a Stage run today (the user's answer of 2026-10-27). */
  readonly tasksTouched: number;
  readonly desks: Desks;
  /** Each engine's whose account's windows were read, in the order each was first read. */
  readonly fiveHourWindows: readonly EngineFiveHourWindow[];
  /** Undefined while the fire alarm is off. */
  readonly fireAlarm: FireAlarmOnNow | undefined;
}

export interface StartedTask {
  readonly task: OfficeTask;
  /** Undefined while it has no Stages of its own. */
  readonly stages: readonly StageOfTask[] | undefined;
}

/** What Now is made of, as read from the modules that own each part. */
export interface NowParts {
  readonly started: readonly StartedTask[];
  readonly openDecisions: readonly OpenDecision[];
  /** First place first. */
  readonly queued: readonly QueuedOnNow[];
  readonly tasks: readonly OfficeTask[];
  readonly leftAt: Date | undefined;
  /** The outcomes since the user left. */
  readonly outcomes: readonly TaskOutcome[];
  readonly tokensToday: TokenKinds;
  readonly tasksTouched: number;
  readonly officeWideLimit: number;
  readonly fiveHourWindows: readonly EngineFiveHourWindow[];
  readonly fireAlarm: NowFireAlarm;
  /** How each Task the alarm paused would resume, by its id; read only while the alarm is on. */
  readonly resumes: ReadonlyMap<string, TaskResume | undefined>;
}

export function nowOf(parts: NowParts): Now {
  const gates = parts.started.flatMap(({ task, stages }) => {
    const gate = stages && waitingGateOf(task, stages);
    return gate ? [gate] : [];
  });
  const running = parts.started.map(({ task, stages }) => ({
    taskId: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    stage: stages && currentStageOf(stages),
  }));
  return {
    needsYou: needsYouOf(parts.openDecisions, gates, parts.tasks),
    running,
    queue: queueOf(parts.queued, parts.tasks),
    leftAt: parts.leftAt,
    sinceYouLeft: finishedTasksOf(parts.outcomes, parts.tasks),
    tokensToday: parts.tokensToday,
    tasksTouched: parts.tasksTouched,
    desks: { inUse: parts.started.length, limit: parts.officeWideLimit },
    fiveHourWindows: parts.fiveHourWindows,
    fireAlarm: fireAlarmOf(parts, running),
  };
}

function fireAlarmOf(
  { fireAlarm, started, resumes }: NowParts,
  running: readonly RunningTask[],
): FireAlarmOnNow | undefined {
  if (!fireAlarm.on) return undefined;
  const pausedIds = new Set(
    started.filter(({ task }) => task.pausedByAlarm).map(({ task }) => task.id),
  );
  const paused = running
    .filter(({ taskId }) => pausedIds.has(taskId))
    .map(({ taskId, title, projectId, stage }) => ({
      taskId,
      title,
      projectId,
      stage,
      resume: resumes.get(taskId),
    }));
  return {
    since: fireAlarm.since,
    stopping: paused.some(({ resume }) => resume === undefined),
    paused,
    resumeTokens: paused.reduce((sum, { resume }) => sum + (resume?.tokens ?? 0), 0),
  };
}

function queueOf(queued: readonly QueuedOnNow[], tasks: readonly OfficeTask[]): QueuedTask[] {
  return queued.flatMap(({ taskId, reasons }, index) => {
    const task = tasks.find(({ id }) => id === taskId);
    if (!task) return [];
    return [{ taskId, title: task.title, projectId: task.projectId, place: index + 1, reasons }];
  });
}

/** The Gate the Task waits at, if it does: since the Gate's run ended as the Task reached it. */
export function waitingGateOf(
  task: Pick<OfficeTask, "id" | "projectId">,
  stages: readonly StageOfTask[],
): WaitingGate | undefined {
  const gate = stages.find(
    ({ stage, state }) => stage.kind === "gate" && state === "waiting-on-you",
  );
  const run = gate?.runs.at(-1);
  return (
    gate &&
    run && {
      kind: "gate",
      taskId: task.id,
      projectId: task.projectId,
      stageKey: gate.stage.key,
      waitingSince: run.endedAt ?? run.startedAt,
    }
  );
}

export function currentStageOf(stages: readonly StageOfTask[]): CurrentStage | undefined {
  let current: { readonly stage: StageOfTask["stage"]; readonly since: Date } | undefined;
  for (const { stage, runs } of stages) {
    const latest = runs.at(-1);
    if (latest && (!current || latest.startedAt.getTime() >= current.since.getTime())) {
      current = { stage, since: latest.startedAt };
    }
  }
  return (
    current && {
      key: current.stage.key,
      name: current.stage.name,
      role: current.stage.role,
      since: current.since,
    }
  );
}

/** A Decision on a Task Work no longer knows is left out. */
function needsYouOf(
  decisions: readonly OpenDecision[],
  gates: readonly WaitingGate[],
  tasks: readonly OfficeTask[],
): NeedsYouItem[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const waiting: NeedsYouItem[] = [
    ...decisions.flatMap(({ id, taskId, askedAt }): WaitingDecision[] => {
      const task = byId.get(taskId);
      return task
        ? [
            {
              kind: "decision",
              decisionId: id,
              taskId,
              projectId: task.projectId,
              waitingSince: askedAt,
            },
          ]
        : [];
    }),
    ...gates,
  ];
  return waiting.toSorted(
    (one, other) => one.waitingSince.getTime() - other.waitingSince.getTime(),
  );
}

/** An outcome of a Task Work no longer knows is left out. */
function finishedTasksOf(
  outcomes: readonly TaskOutcome[],
  tasks: readonly OfficeTask[],
): FinishedTask[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return latestPerTask(outcomes).flatMap(({ taskId, outcome, occurredAt }) => {
    const task = byId.get(taskId);
    return task
      ? [{ taskId, title: task.title, projectId: task.projectId, outcome, occurredAt }]
      : [];
  });
}
