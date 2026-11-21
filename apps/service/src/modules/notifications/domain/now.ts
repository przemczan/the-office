import type { TokenKinds } from "./office-day.js";
import { latestPerTask, type TaskOutcome, type TaskOutcomeKind } from "./task-outcome.js";

/** A Task as Now shows it, from Work. */
export interface OfficeTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
  /**
   * What holds it Paused apart from the user's own Pause: `alarm` for the fire alarm, `initiative`
   * for its Initiative's Pause, `usage-window` for its engine's used-up usage window; undefined for
   * none.
   */
  readonly pausedBy: string | undefined;
  /** When a Task the usage window paused resumes by itself; undefined otherwise. */
  readonly resumesAt: Date | undefined;
}

/** An Initiative as Now reads it, from Work. */
export interface OfficeInitiative {
  readonly id: string;
  readonly name: string;
  /** Shaping, active, done or dropped: Now shows only those in Shaping. */
  readonly state: string;
  /** Shaping counts from here: an Initiative is in Shaping from the moment it is made. */
  readonly createdAt: Date;
}

/** One of an Initiative's Tasks, as Now counts it, from Work. */
export interface InitiativeTask {
  readonly projectId: string;
  readonly state: string;
}

/** An Initiative being shaped, as Now's Shaping section shows it. */
export interface ShapingInitiative {
  readonly initiativeId: string;
  readonly title: string;
  /** The Projects its Tasks so far are in, in the order its Tasks came. */
  readonly projectIds: readonly string[];
  /** Who holds Shapes Initiatives, by their Role's key; undefined while nobody does. */
  readonly shapedBy: string | undefined;
  readonly taskCount: number;
  readonly since: Date;
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

/**
 * A Decision that waits on the user, from Conversations: on a Task, or on no Task in one of an
 * Initiative's Threads (`initiativeId` set).
 */
export interface OpenDecision {
  readonly id: string;
  readonly threadId: string;
  readonly taskId?: string | undefined;
  readonly initiativeId?: string | undefined;
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
  /** For an Agent Stage naming a duty rather than a Role, the Role working it, if anyone does. */
  readonly workedBy?: string;
  readonly runs: readonly { readonly startedAt: Date; readonly endedAt: Date | undefined }[];
}

/** One of an account's usage windows, from the Engine. */
export interface UsageWindow {
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
}

/** One engine's account's usage windows. */
export interface EngineUsageWindows {
  readonly engineId: string;
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
}

export interface WaitingDecision {
  readonly kind: "decision";
  readonly decisionId: string;
  readonly taskId: string;
  /** The Task's, so the Project filter can narrow what waits. */
  readonly projectId: string;
  readonly waitingSince: Date;
}

/** A Decision on no Task, waiting in an Initiative's shaping or planning Thread. */
export interface WaitingInitiativeDecision {
  readonly kind: "initiative-decision";
  readonly decisionId: string;
  readonly initiativeId: string;
  /** The Initiative's Thread it waits in, where it is answered. */
  readonly threadId: string;
  /** The Projects the Initiative spans, so the Project filter can narrow what waits. */
  readonly projectIds: readonly string[];
  readonly waitingSince: Date;
}

export interface WaitingGate {
  readonly kind: "gate";
  readonly taskId: string;
  readonly projectId: string;
  readonly stageKey: string;
  readonly waitingSince: Date;
}

/**
 * A Stage held as its engine's usage window was used up, waiting for the user's choice of going on
 * on a Stand-in Engine now or waiting for the reset (spec 5.4), from Pipelines.
 */
export interface StandInChoiceWaiting {
  readonly taskId: string;
  readonly projectId: string;
  readonly waitingSince: Date;
  /** The used-up window's reset, as an ISO time. */
  readonly resetsAt: string;
  /** The Stand-in Engine it would move to now; null while none has room. */
  readonly standInNow: { readonly engineName: string } | null;
  /** The Stand-in Engine that had room as the Stage was held. */
  readonly asked: { readonly engineName: string };
}

/**
 * The Office's own Decision on every Stage waiting for the user's choice of a Stand-in Engine: one
 * item for them all, however many wait.
 */
export interface WaitingStandInChoices {
  readonly kind: "stand-in-choice";
  /** The Projects of the waiting Stages' Tasks, so the Project filter can narrow what waits. */
  readonly projectIds: readonly string[];
  /** The oldest waiting Stage's. */
  readonly waitingSince: Date;
  readonly count: number;
}

/** What waits on the user. A message from a person joins with tier 2 (the user's answer of 2026-10-27). */
export type NeedsYouItem =
  WaitingDecision | WaitingInitiativeDecision | WaitingGate | WaitingStandInChoices;

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
  /** What holds it Paused, as `OfficeTask.pausedBy` says. */
  readonly pausedBy: string | undefined;
  readonly resumesAt: Date | undefined;
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
  /** The Initiatives in Shaping, oldest first (the user's request of 2026-11-15). */
  readonly shaping: readonly ShapingInitiative[];
  readonly tokensToday: TokenKinds;
  readonly desks: Desks;
  /** Each engine's whose account's windows were read, in the order each was first read. */
  readonly usageWindows: readonly EngineUsageWindows[];
  /** Undefined while the fire alarm is off. */
  readonly fireAlarm: FireAlarmOnNow | undefined;
}

/**
 * Since you left for one user (spec §4): where it begins, at the start of their own last absence,
 * and each Task's latest outcome since then. Now is shared by every user; this is each one's own.
 */
export interface SinceYouLeft {
  /** Undefined until the user is first seen. */
  readonly leftAt: Date | undefined;
  /** Each Task's latest outcome since the user left, latest first. */
  readonly finished: readonly FinishedTask[];
}

/** Since you left from where it begins and the outcomes since then, of the Tasks Work knows. */
export function sinceYouLeftOf(
  leftAt: Date | undefined,
  outcomes: readonly TaskOutcome[],
  tasks: readonly OfficeTask[],
): SinceYouLeft {
  return { leftAt, finished: finishedTasksOf(outcomes, tasks) };
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
  /** The Tasks the open Decisions and the queue name, at least. */
  readonly tasks: readonly OfficeTask[];
  readonly initiatives: readonly OfficeInitiative[];
  /** Each Initiative's Tasks, by the Initiative's id. */
  readonly initiativeTasks: ReadonlyMap<string, readonly InitiativeTask[]>;
  /** Who holds Shapes Initiatives, by their Role's key; undefined while nobody does. */
  readonly shaper: string | undefined;
  readonly tokensToday: TokenKinds;
  readonly officeWideLimit: number;
  readonly usageWindows: readonly EngineUsageWindows[];
  readonly fireAlarm: NowFireAlarm;
  /** How each Task the alarm paused would resume, by its id; read only while the alarm is on. */
  readonly resumes: ReadonlyMap<string, TaskResume | undefined>;
  readonly standInChoices: readonly StandInChoiceWaiting[];
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
    pausedBy: task.pausedBy,
    resumesAt: task.resumesAt,
    stage: stages && currentStageOf(stages),
  }));
  return {
    needsYou: needsYouOf(parts, gates),
    running,
    queue: queueOf(parts.queued, parts.tasks),
    shaping: shapingOf(parts),
    tokensToday: parts.tokensToday,
    desks: { inUse: parts.started.length, limit: parts.officeWideLimit },
    usageWindows: parts.usageWindows,
    fireAlarm: fireAlarmOf(parts, running),
  };
}

function fireAlarmOf(
  { fireAlarm, started, resumes }: NowParts,
  running: readonly RunningTask[],
): FireAlarmOnNow | undefined {
  if (!fireAlarm.on) return undefined;
  const pausedIds = new Set(
    started.filter(({ task }) => task.pausedBy === "alarm").map(({ task }) => task.id),
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

/**
 * The Initiatives in Shaping, oldest first, each with its Tasks so far and their Projects; a Task
 * Dropped no longer counts.
 */
function shapingOf({ initiatives, initiativeTasks, shaper }: NowParts): ShapingInitiative[] {
  return initiatives
    .filter(({ state }) => state === "shaping")
    .toSorted(
      (one, other) =>
        one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id),
    )
    .map(({ id, name, createdAt }) => {
      const tasks = liveTasksOf(initiativeTasks.get(id));
      return {
        initiativeId: id,
        title: name,
        projectIds: projectsOf(tasks),
        shapedBy: shaper,
        taskCount: tasks.length,
        since: createdAt,
      };
    });
}

/** An Initiative's Tasks but those Dropped, which no longer count. */
function liveTasksOf(tasks: readonly InitiativeTask[] | undefined): readonly InitiativeTask[] {
  return (tasks ?? []).filter(({ state }) => state !== "dropped");
}

/** The Projects an Initiative spans: those of its Tasks not Dropped, in the order its Tasks came. */
function projectsOf(tasks: readonly InitiativeTask[] | undefined): string[] {
  return [...new Set(liveTasksOf(tasks).map(({ projectId }) => projectId))];
}

/** An Initiative in one of these has ended: its Decisions on no Task no longer wait. */
const ENDED_INITIATIVE_STATES: readonly string[] = ["done", "dropped"];

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
  let current: (StageOfTask & { readonly since: Date }) | undefined;
  for (const stage of stages) {
    const latest = stage.runs.at(-1);
    if (latest && (!current || latest.startedAt.getTime() >= current.since.getTime())) {
      current = { ...stage, since: latest.startedAt };
    }
  }
  return (
    current && {
      key: current.stage.key,
      name: current.stage.name,
      role: current.stage.role ?? current.workedBy,
      since: current.since,
    }
  );
}

/**
 * A Decision on a Task Work no longer knows is left out, as is one on an Initiative Work no longer
 * knows or that ended (Done or Dropped).
 */
function needsYouOf(
  { openDecisions, tasks, initiatives, initiativeTasks, standInChoices }: NowParts,
  gates: readonly WaitingGate[],
): NeedsYouItem[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const initiativesById = new Map(initiatives.map((initiative) => [initiative.id, initiative]));
  const waiting: NeedsYouItem[] = [
    ...openDecisions.flatMap(({ id, threadId, taskId, initiativeId, askedAt }): NeedsYouItem[] => {
      if (taskId !== undefined) {
        const task = tasksById.get(taskId);
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
      }
      const initiative = initiativeId === undefined ? undefined : initiativesById.get(initiativeId);
      if (!initiative || ENDED_INITIATIVE_STATES.includes(initiative.state)) return [];
      return [
        {
          kind: "initiative-decision",
          decisionId: id,
          initiativeId: initiative.id,
          threadId,
          projectIds: projectsOf(initiativeTasks.get(initiative.id)),
          waitingSince: askedAt,
        },
      ];
    }),
    ...gates,
    ...waitingStandInChoicesOf(standInChoices),
  ];
  return waiting.toSorted(
    (one, other) => one.waitingSince.getTime() - other.waitingSince.getTime(),
  );
}

/** One item for every Stage waiting for the choice, none while none waits. */
function waitingStandInChoicesOf(
  choices: readonly StandInChoiceWaiting[],
): WaitingStandInChoices[] {
  if (choices.length === 0) return [];
  const since = Math.min(...choices.map(({ waitingSince }) => waitingSince.getTime()));
  return [
    {
      kind: "stand-in-choice",
      projectIds: [...new Set(choices.map(({ projectId }) => projectId))],
      waitingSince: new Date(since),
      count: choices.length,
    },
  ];
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
