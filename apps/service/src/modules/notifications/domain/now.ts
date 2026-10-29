import { latestPerTask, type TaskOutcome, type TaskOutcomeKind } from "./task-outcome.js";

/** A Task as Now shows it, from Work. */
export interface OfficeTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: string;
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

/** The account's 5-hour window, from the Engine. */
export interface FiveHourWindow {
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
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
  readonly tokensToday: number;
  /** The Tasks with a Stage run today (the user's answer of 2026-10-27). */
  readonly tasksTouched: number;
  readonly desks: Desks;
  /** Undefined until the engine first reports the account's windows. */
  readonly fiveHourWindow: FiveHourWindow | undefined;
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
  readonly tokensToday: number;
  readonly tasksTouched: number;
  readonly officeWideLimit: number;
  readonly fiveHourWindow: FiveHourWindow | undefined;
}

export function nowOf(parts: NowParts): Now {
  const gates = parts.started.flatMap(({ task, stages }) => {
    const gate = stages && waitingGateOf(task, stages);
    return gate ? [gate] : [];
  });
  return {
    needsYou: needsYouOf(parts.openDecisions, gates, parts.tasks),
    running: parts.started.map(({ task, stages }) => ({
      taskId: task.id,
      title: task.title,
      projectId: task.projectId,
      state: task.state,
      stage: stages && currentStageOf(stages),
    })),
    queue: queueOf(parts.queued, parts.tasks),
    leftAt: parts.leftAt,
    sinceYouLeft: finishedTasksOf(parts.outcomes, parts.tasks),
    tokensToday: parts.tokensToday,
    tasksTouched: parts.tasksTouched,
    desks: { inUse: parts.started.length, limit: parts.officeWideLimit },
    fiveHourWindow: parts.fiveHourWindow,
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
