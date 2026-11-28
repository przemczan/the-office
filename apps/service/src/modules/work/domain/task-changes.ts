import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { userBehind as userBehindAuthor, type Author, type UserRef } from "./author.js";
import { boardOrder, placementBetween, type Neighbours } from "./manual-order.js";
import { dropReasonProblems, keptDropReason, type DropReason } from "./drop-reason.js";
import {
  newTaskProblems,
  trimmedNewTask,
  type NewTask,
  type Priority,
  type Task,
  type TaskKind,
} from "./task.js";
import {
  TaskBugDetailsChanged,
  TaskCreated,
  TaskDefinitionOfDoneConfirmed,
  TaskHeldAtAllClear,
  TaskKindChanged,
  TaskMarkedReadyAsItStands,
  TaskPaused,
  TaskPlanConfirmed,
  TaskPriorityChanged,
  TaskReopened,
  TaskReordered,
  TaskResumed,
  TaskStartedOver,
  TaskStateChanged,
  TaskStopped,
  TaskWentOnOnStandIn,
  type UsageWindowRefusal,
} from "./task-events.js";
import type { EngineStandIn } from "./stand-ins-at-start.js";
import type { RecordEdit } from "./record-edits.js";
import {
  BY_THE_FIRE_ALARM,
  BY_THE_PIPELINE,
  BY_THE_USAGE_WINDOW,
  byWayBack,
  userBehind,
  type BranchReset,
  type PersonAuthor,
  type StateChange,
  type StateChangeCause,
} from "./state-change.js";
import { TaskRefused } from "./task-refused.js";
import { restoreTask } from "./task-archive.js";
import { writtenParts, type WrittenPlanAndDefinitionOfDone } from "./written-parts.js";
import {
  ALARM_HOLDS_THE_TASK,
  CONDITIONS_KEPT_WHEN_CONFIRMING,
  INITIATIVE_PAUSED_RESUME,
  NOT_STARTED_STATES,
  STARTED_STATES,
  TASK_STATE_NAMES,
  moveProblems,
  openDecisionProblems,
  readinessLines,
  reopenProblems,
  restartProblems,
  startOverProblems,
  stateChangeProblems,
  type ReopenGrounds,
  type ReopenTo,
  type StartOverTo,
  type WayBackHolds,
} from "./task-states.js";

/**
 * A Task after a change, with the event that announces it, and the move between states and the
 * edits it makes (`withTaskEdits`), kept with the Task as it is saved.
 */
export interface TaskChange<Event extends DomainEvent> {
  readonly task: Task;
  readonly event: Event;
  readonly stateChange?: StateChange;
  readonly edits?: readonly RecordEdit[];
}

/**
 * The change, with its move kept when it takes the Task to another state, and its `endedAt` set by
 * a move to Done or Dropped and cleared by any other move.
 */
export function withStateChange<Event extends DomainEvent>(
  change: TaskChange<Event>,
  from: Task,
  by: StateChangeCause,
): TaskChange<Event> {
  const { state } = change.task;
  if (state === from.state) return change;
  const at = change.event.occurredAt;
  const endedAt = state === "done" || state === "dropped" ? at : undefined;
  return {
    ...change,
    task: { ...change.task, endedAt },
    stateChange: { from: from.state, to: state, at, by },
  };
}

/** A Task the usage window doesn't hold: no resume of its own, no engine and no pause time kept. */
const NO_USAGE_WINDOW_RESUME = {
  resumesAt: undefined,
  usageWindowEngineId: undefined,
  usageWindowPausedAt: undefined,
} as const satisfies Partial<Task>;

/**
 * Where a new Task comes from beyond who created it: whether The Office created it by itself (an
 * approved Bug Task, an auto-imported issue), a Bug's Caused by, and the Task it was found while
 * working on, of any Kind, set as it is created. None by default.
 */
export interface NewTaskOrigin {
  readonly createdByTheOffice?: boolean;
  readonly causedBy?: string;
  readonly foundWhileWorkingOn?: string;
}

/** What The Office sets on a new Task. */
export interface NewTaskSetting extends NewTaskOrigin {
  readonly order: string;
  readonly originIdeaId: string | undefined;
  readonly initiativeId: string | undefined;
  readonly createdBy: Author;
}

/**
 * A new Task starts in Backlog, or in Shaping when its Initiative is still being shaped: unplanned,
 * or with a Plan and a Definition of Done written by whoever creates it, both unconfirmed until the
 * user confirms them, and with no Pipeline until one is chosen (spec §2.1). Refuses with every
 * reason.
 */
export function createTask(
  id: string,
  given: NewTask,
  setting: NewTaskSetting,
  createdAt: Date,
  state: Extract<Task["state"], "shaping" | "backlog"> = "backlog",
  written?: WrittenPlanAndDefinitionOfDone,
): TaskChange<TaskCreated> {
  const newTask = trimmedNewTask(given);
  const { parts, problems: partsProblems } = writtenParts(written);
  const problems = [...newTaskProblems(newTask), ...partsProblems];
  if (problems.length > 0) throw new TaskRefused(problems);
  const task: Task = {
    id,
    ...newTask,
    state,
    order: setting.order,
    ...parts,
    planConfirmed: false,
    definitionOfDoneConfirmed: false,
    commitMessage: "",
    commitMessagePublishedAt: undefined,
    pipelineId: undefined,
    proposedPipeline: undefined,
    autoMode: false,
    initiativePlanningThreadId: undefined,
    markedPlanned: false,
    hasPlanningThread: false,
    personRole: undefined,
    engineStandIns: [],
    pausedBy: undefined,
    ...NO_USAGE_WINDOW_RESUME,
    madeFor: undefined,
    resolvesTaskId: undefined,
    blockedBy: [],
    originIdeaId: setting.originIdeaId,
    initiativeId: setting.initiativeId,
    projectMoves: [],
    createdBy: setting.createdBy,
    createdAt,
    archivedAt: undefined,
    archivedBy: undefined,
    restoredAt: undefined,
    restoredBy: undefined,
    endedAt: undefined,
    pullRequestEnd: undefined,
    branchDeletion: undefined,
    causedBy: setting.causedBy,
    foundInVersion: undefined,
    foundWhileWorkingOn: setting.foundWhileWorkingOn,
    dropReason: undefined,
    createdByTheOffice: setting.createdByTheOffice ?? false,
    engineOverride: null,
    peopleEngineSettings: [],
  };
  return {
    task,
    event: new TaskCreated(task),
    stateChange: { from: undefined, to: task.state, at: createdAt, by: setting.createdBy },
  };
}

/** Undefined when the Task is already there; refused when the move breaks the state rules. */
export function changeTaskState(
  task: Task,
  to: Task["state"],
  by: StateChangeCause,
): TaskChange<TaskStateChanged> | undefined {
  const problems = stateChangeProblems(task, to);
  if (problems.length > 0) throw new TaskRefused(problems);
  if (task.state === to) return undefined;
  return stateMove(task, to, by);
}

/** The move to `to`, its conditions weighed already. */
function stateMove(
  task: Task,
  to: Task["state"],
  by: StateChangeCause,
): TaskChange<TaskStateChanged> {
  return withStateChange(
    {
      task: { ...task, state: to, pausedBy: undefined, ...NO_USAGE_WINDOW_RESUME },
      event: new TaskStateChanged(task.id, task.state, to),
    },
    task,
    by,
  );
}

/**
 * Where a Task is planned: in a planning Thread of its own, moved there `by` the user who asked, or
 * in its Initiative's planning Thread, moved there `by` the person planning it as its turn comes
 * (start_planning).
 */
export type PlanningThread =
  | { readonly kind: "own"; readonly by: Author }
  | { readonly kind: "initiative"; readonly threadId: string; readonly by: Author };

/**
 * Backlog → Planning, in auto mode or not and in the Thread it is planned in, set in the same save
 * so the move and those never drift apart; not marked planned, whatever an earlier planning left.
 * Undefined when the Task is in Planning already, keeping what it has.
 */
export function startPlanningTask(
  task: Task,
  autoMode: boolean,
  thread: PlanningThread,
): TaskChange<TaskStateChanged> | undefined {
  const by: StateChangeCause = thread.by;
  const change = changeTaskState(task, "planning", by);
  if (!change) return undefined;
  const initiativePlanningThreadId = thread.kind === "own" ? undefined : thread.threadId;
  return {
    ...change,
    task: {
      ...change.task,
      autoMode,
      initiativePlanningThreadId,
      markedPlanned: false,
      hasPlanningThread: true,
    },
  };
}

/**
 * Planning → Backlog, when planning couldn't begin: a Task is never in Planning without its
 * planning Thread, so it has none to go back to either. Undefined when the Task has already left
 * Planning.
 */
export function undoPlanningMove(task: Task): TaskChange<TaskStateChanged> | undefined {
  if (task.state !== "planning") return undefined;
  return withStateChange(
    {
      task: { ...task, state: "backlog", hasPlanningThread: false },
      event: new TaskStateChanged(task.id, "planning", "backlog"),
    },
    task,
    { kind: "office", reason: "its planning Thread couldn't be opened" },
  );
}

/**
 * Shaping → Backlog, as the user confirms the Task's Initiative. Moved here rather than by
 * `changeTaskState`, as nobody may ask for this move on its own.
 */
export function moveToBacklogOnConfirm(task: Task, by: Author): TaskChange<TaskStateChanged> {
  return withStateChange(
    {
      task: { ...task, state: "backlog" },
      event: new TaskStateChanged(task.id, task.state, "backlog"),
    },
    task,
    by,
  );
}

/**
 * Backlog, Planning or Ready → Shaping, as the user takes the Task's Initiative Back to Shaping.
 * Its Plan, Definition of Done and Pipeline stay, Not confirmed, its Pipeline as proposed unless
 * one is proposed already, and it is no longer marked planned nor planned in an Initiative's
 * planning Thread, so the next Confirm has it planned again. Moved here rather than by
 * `changeTaskState`, as nobody may ask for this move on its own.
 */
export function moveToShapingOnBackToShaping(task: Task, by: Author): TaskChange<TaskStateChanged> {
  return withStateChange(
    {
      task: {
        ...task,
        ...unconfirmedPlanning(task, PIPELINE_KEPT_AT_BACK_TO_SHAPING),
        state: "shaping",
      },
      event: new TaskStateChanged(task.id, task.state, "shaping"),
    },
    task,
    by,
  );
}

const PIPELINE_KEPT_AT_BACK_TO_SHAPING =
  "Chosen before its Initiative went Back to Shaping; confirm it again.";

const PIPELINE_KEPT_AT_START_OVER = "Followed before the Task started over; confirm it again.";

/**
 * The Task's Plan, Definition of Done and Pipeline kept but Not confirmed, its Pipeline as proposed
 * unless one is proposed already, and the Task no longer marked planned nor planned anywhere, so
 * the next Confirm has it planned again. `pipelineReason` is why its Pipeline is proposed.
 */
function unconfirmedPlanning(task: Task, pipelineReason: string): Partial<Task> {
  const proposedPipeline =
    task.proposedPipeline ??
    (task.pipelineId === undefined
      ? undefined
      : { pipelineId: task.pipelineId, reason: pipelineReason });
  return {
    planConfirmed: false,
    definitionOfDoneConfirmed: false,
    pipelineId: undefined,
    proposedPipeline,
    autoMode: false,
    initiativePlanningThreadId: undefined,
    markedPlanned: false,
    hasPlanningThread: false,
  };
}

/** How the user marks a Task Ready: `confirmPlanAndDefinitionOfDone` confirms both as they stand. */
export interface MarkReadyChoice {
  readonly confirmPlanAndDefinitionOfDone: boolean;
}

/**
 * Mark Ready: Backlog or Planning → Ready, refused with every reason, those of the Task's record and the
 * Decisions on it still open; by the user, or by auto mode on their behalf. Undefined when the Task
 * is Ready already. With `confirmPlanAndDefinitionOfDone`, the user's choice in the dialog naming
 * what is missing (spec §2.1), the Plan and the Definition of Done not yet confirmed are confirmed
 * as they stand, even empty, by `by`, in the same save; the Pipeline and the open Decisions still
 * hold it back.
 */
export function markTaskReady(
  task: Task,
  openDecisions: number,
  by: StateChangeCause,
): TaskChange<TaskStateChanged> | undefined;
export function markTaskReady(
  task: Task,
  openDecisions: number,
  by: StateChangeCause,
  choice: MarkReadyChoice,
): TaskChange<TaskMarkedReadyAsItStands> | undefined;
export function markTaskReady(
  task: Task,
  openDecisions: number,
  by: StateChangeCause,
  choice?: MarkReadyChoice,
): TaskChange<TaskStateChanged | TaskMarkedReadyAsItStands> | undefined {
  if (task.state === "ready") return undefined;
  if (!choice?.confirmPlanAndDefinitionOfDone) {
    const problems = [
      ...stateChangeProblems(task, "ready"),
      ...openDecisionProblems(openDecisions),
    ];
    if (problems.length > 0) throw new TaskRefused(problems);
    const ready = stateMove(task, "ready", by);
    if (!choice) return ready;
    return { ...ready, event: new TaskMarkedReadyAsItStands(task.id, [], ready.event) };
  }
  const problems = [
    ...moveProblems(task, "ready"),
    ...readinessLines(task, openDecisions)
      .filter(({ part }) => CONDITIONS_KEPT_WHEN_CONFIRMING.includes(part))
      .flatMap(({ problems: unmet }) => unmet),
  ];
  if (problems.length > 0) throw new TaskRefused(problems);
  const confirmations: (TaskPlanConfirmed | TaskDefinitionOfDoneConfirmed)[] = [];
  let confirmed = task;
  if (!confirmed.planConfirmed) {
    confirmed = { ...confirmed, planConfirmed: true };
    confirmations.push(new TaskPlanConfirmed(task.id));
  }
  if (!confirmed.definitionOfDoneConfirmed) {
    confirmed = { ...confirmed, definitionOfDoneConfirmed: true };
    confirmations.push(new TaskDefinitionOfDoneConfirmed(task.id));
  }
  const ready = stateMove(confirmed, "ready", by);
  return { ...ready, event: new TaskMarkedReadyAsItStands(task.id, confirmations, ready.event) };
}

/**
 * A started Task moved along its Pipeline by the Stage interpreter. Only Start moves a Ready Task
 * to In progress, so a Task that hasn't started, or has ended, is refused. A Paused Task is held by
 * the user and only Resume moves it on, so the move is undefined: the walk finds it Paused.
 */
export function changeStartedTaskState(
  task: Task,
  to: Task["state"],
): TaskChange<TaskStateChanged> | undefined {
  if (!STARTED_STATES.includes(task.state)) {
    throw new TaskRefused([
      `Only a started Task moves along its Pipeline; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (task.state === "paused") return undefined;
  return changeTaskState(task, to, BY_THE_PIPELINE);
}

/**
 * Pause (spec §2.4): a Task In progress or Waiting on you is held as Paused, its running Stage once
 * the Agent's current turn ends; by the user, or by The Office for a reason the walk can't go on
 * with. Undefined when it is Paused already.
 */
export function pauseTask(task: Task, by: StateChangeCause): TaskChange<TaskPaused> | undefined {
  if (task.state === "paused") return undefined;
  refuseUnlessRunning(task, "paused");
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: undefined, ...NO_USAGE_WINDOW_RESUME },
      event: new TaskPaused(task.id, task.state, "user", undefined, userBehind(by)),
    },
    task,
    by,
  );
}

/**
 * The fire alarm sounding (spec §2.8): a Task In progress or Waiting on you is held as Paused by
 * the alarm, its running Stage at its next safe point. Undefined for any other: a Task the user
 * paused stays theirs.
 */
export function pauseTaskForAlarm(task: Task): TaskChange<TaskPaused> | undefined {
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return undefined;
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: "alarm" },
      event: new TaskPaused(task.id, task.state, "alarm"),
    },
    task,
    BY_THE_FIRE_ALARM,
  );
}

/**
 * A pause by the usage window (spec §2.1): a Stage's turn was refused because its engine's usage
 * window is used up, so a Task In progress or Waiting on you is held Paused until the window's
 * reset, its Stage's run already ended held, keeping the engine that refused and when (`now`, by
 * The Office's clock) for an early resume. One paused by the usage window has its resume moved to
 * the new reset. Undefined for any other: a Task the user, the alarm or its Initiative holds stays
 * theirs.
 */
export function pauseTaskForUsageWindow(
  task: Task,
  refusal: UsageWindowRefusal,
  now: Date,
): TaskChange<TaskPaused> | undefined {
  const pausedByTheWindow = task.state === "paused" && task.pausedBy === "usage-window";
  if (!pausedByTheWindow && task.state !== "in-progress" && task.state !== "waiting-on-you") {
    return undefined;
  }
  return withStateChange(
    {
      task: {
        ...task,
        state: "paused",
        pausedBy: "usage-window",
        resumesAt: refusal.resetsAt,
        usageWindowEngineId: refusal.engineId,
        usageWindowPausedAt: now,
      },
      event: new TaskPaused(task.id, task.state, "usage-window", refusal),
    },
    task,
    BY_THE_USAGE_WINDOW,
  );
}

/**
 * A running Stage of the Task went on on a Stand-in Engine as its engine's usage window was used up
 * (spec 5.4): `standIn` replaces the Task's entry for the same cascade's engine, or is added, so the
 * run's later Stages open on it; back on the cascade's engine itself, the entry goes. The next Start
 * chooses the list afresh. A Paused Task takes it too: the user's Switch now moves a held Stage's
 * session before resuming the Task, and a Pause asked while the session switched holds it there.
 * Undefined for a Task not started or ended, and when the list already says so.
 */
export function taskWentOnOnStandIn(
  task: Task,
  standIn: EngineStandIn,
): TaskChange<TaskWentOnOnStandIn> | undefined {
  if (task.state !== "in-progress" && task.state !== "waiting-on-you" && task.state !== "paused") {
    return undefined;
  }
  const kept = task.engineStandIns.find(({ engineId }) => engineId === standIn.engineId);
  const backOnItsOwn = standIn.standInId === standIn.engineId;
  if (backOnItsOwn ? kept === undefined : kept?.standInId === standIn.standInId) return undefined;
  const others = task.engineStandIns.filter((entry) => entry !== kept);
  const engineStandIns = backOnItsOwn
    ? others
    : kept
      ? task.engineStandIns.map((entry) => (entry === kept ? standIn : entry))
      : [...task.engineStandIns, standIn];
  return {
    task: { ...task, engineStandIns },
    event: new TaskWentOnOnStandIn(task.id, standIn.engineId, standIn.standInId),
  };
}

/**
 * The usage window's reset, for a Task it paused: the Task goes on In progress, where its Pipeline
 * was held, or, while the fire alarm is on, is held by the alarm until the all clear, as a Resume
 * then is. Undefined for any other Task, among them one an early resume took on already, and
 * before its reset.
 */
export function resumeTaskAtReset(
  task: Task,
  { alarmHoldsResume, now }: { readonly alarmHoldsResume: boolean; readonly now: Date },
): TaskChange<TaskResumed | TaskPaused> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "usage-window") return undefined;
  if (task.resumesAt !== undefined && task.resumesAt > now) return undefined;
  return resumedFromUsageWindow(task, alarmHoldsResume);
}

/**
 * A reading of `engineId`'s usage windows, taken at `readAt`, that Engine judges free: a Task that
 * engine's usage window paused before then resumes now, before its reset, as at the reset. Undefined
 * for any other Task: paused by another engine, by none kept (paused before engines were kept), or
 * after the reading was taken.
 */
export function resumeTaskFreedByUsageWindow(
  task: Task,
  {
    alarmHoldsResume,
    engineId,
    readAt,
  }: { readonly alarmHoldsResume: boolean; readonly engineId: string; readonly readAt: Date },
): TaskChange<TaskResumed | TaskPaused> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "usage-window") return undefined;
  if (task.usageWindowEngineId !== engineId) return undefined;
  if (task.usageWindowPausedAt === undefined || task.usageWindowPausedAt >= readAt) {
    return undefined;
  }
  return resumedFromUsageWindow(task, alarmHoldsResume);
}

function resumedFromUsageWindow(
  task: Task,
  alarmHoldsResume: boolean,
): TaskChange<TaskResumed | TaskPaused> {
  if (alarmHoldsResume) {
    return {
      task: { ...task, pausedBy: "alarm", ...NO_USAGE_WINDOW_RESUME },
      event: new TaskPaused(task.id, "paused", "alarm"),
    };
  }
  return resumed(task, BY_THE_USAGE_WINDOW);
}

/**
 * Stop (spec §2.4): as Pause, but the Stage running now is interrupted; a Task paused already can
 * still be stopped, so its Stage doesn't run to its end. The Stop is the user's, even of a Task
 * the fire alarm paused.
 */
export function stopTask(task: Task, by: Author): TaskChange<TaskStopped> {
  if (task.state !== "paused") refuseUnlessRunning(task, "stopped");
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: undefined, ...NO_USAGE_WINDOW_RESUME },
      event: new TaskStopped(task.id, task.state, userBehind(by)),
    },
    task,
    by,
  );
}

/**
 * Pause the Initiative, for one of its Tasks (spec §2.1): one In progress or Waiting on you is held
 * Paused by the Initiative, its running Stage once the Agent's current turn ends, and one the fire
 * alarm or the usage window holds becomes the Initiative's, so neither the all clear nor the reset
 * resumes it; the usage window's reset is kept for Resume the Initiative. Undefined for any other:
 * a Task the user paused stays theirs.
 */
export function pauseTaskForInitiative(task: Task, by: Author): TaskChange<TaskPaused> | undefined {
  if (task.state === "paused") {
    if (task.pausedBy !== "alarm" && task.pausedBy !== "usage-window") return undefined;
    return {
      task: { ...task, pausedBy: "initiative" },
      event: new TaskPaused(task.id, "paused", "initiative", undefined, userBehind(by)),
    };
  }
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return undefined;
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: "initiative" },
      event: new TaskPaused(task.id, task.state, "initiative", undefined, userBehind(by)),
    },
    task,
    by,
  );
}

/**
 * Resume the Initiative, for one of its Tasks: one its Pause held goes on In progress, where its
 * Pipeline was held, or, while the fire alarm is on, is held by the alarm until the all clear, as a
 * Resume then is; one it took over from the usage window before the window's reset stays paused by
 * the usage window until then. Undefined for any other Task, which the Initiative doesn't hold.
 */
export function resumeTaskForInitiative(
  task: Task,
  { alarmHoldsResume, now }: { readonly alarmHoldsResume: boolean; readonly now: Date },
  by: Author,
): TaskChange<TaskResumed | TaskPaused> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "initiative") return undefined;
  if (task.resumesAt !== undefined && task.resumesAt > now) {
    return {
      task: { ...task, pausedBy: "usage-window" },
      event: new TaskPaused(task.id, "paused", "usage-window"),
    };
  }
  if (alarmHoldsResume) {
    return {
      task: { ...task, pausedBy: "alarm", ...NO_USAGE_WINDOW_RESUME },
      event: new TaskPaused(task.id, "paused", "alarm"),
    };
  }
  return resumed(task, by);
}

export { INITIATIVE_PAUSED_RESUME } from "./task-states.js";

/**
 * Resume: a Paused Task goes on In progress, where its Pipeline was held. While the fire alarm is
 * on, nothing walks (the user's answer of 2026-10-29): the Resume is kept as the alarm holding the
 * Task, which the all clear resumes. While its Initiative is paused, only Resume the Initiative
 * resumes it.
 */
export function resumeTask(
  task: Task,
  {
    alarmHoldsResume,
    initiativePaused,
  }: { readonly alarmHoldsResume: boolean; readonly initiativePaused: boolean },
  by: Author,
): TaskChange<TaskResumed | TaskPaused> {
  if (task.state !== "paused") {
    throw new TaskRefused([
      `Only a Paused Task can be resumed; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (initiativePaused) throw new TaskRefused([INITIATIVE_PAUSED_RESUME]);
  if (!alarmHoldsResume) return resumed(task, by);
  if (task.pausedBy === "alarm") {
    throw new TaskRefused([ALARM_HOLDS_THE_TASK]);
  }
  return {
    task: { ...task, pausedBy: "alarm", ...NO_USAGE_WINDOW_RESUME },
    event: new TaskPaused(task.id, "paused", "alarm"),
  };
}

function resumed(task: Task, by: StateChangeCause): TaskChange<TaskResumed> {
  return withStateChange(
    {
      task: { ...task, state: "in-progress", pausedBy: undefined, ...NO_USAGE_WINDOW_RESUME },
      event: new TaskResumed(task.id),
    },
    task,
    by,
  );
}

/**
 * Restart from… (spec 2.4.5): the user's way back on a Task Paused by their own Pause or Stop, which
 * goes on In progress as Resume does (`TaskResumed`, which the walk reacts to, Pipelines having set
 * the Stage it goes on from), its History naming the Stage, and the person who restarted it at the
 * user's request, if one did. Refused as `restartProblems` says.
 */
export function restartTask(
  task: Task,
  holds: WayBackHolds,
  restart: {
    readonly stageName: string;
    readonly user: UserRef;
    readonly person?: PersonAuthor | undefined;
  },
): TaskChange<TaskResumed> {
  const problems = restartProblems(task, holds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const step = { kind: "restart", stageName: restart.stageName } as const;
  return resumed(task, byWayBack(restart.user, step, restart.person));
}

/**
 * Who takes a way back, as its move records them: the user, or the person with the user who asked
 * them (or allowed their call). Refused when no user is behind the Author.
 */
export function wayBackTakenBy(by: Author): {
  readonly user: UserRef;
  readonly person: PersonAuthor | undefined;
} {
  const user = userBehindAuthor(by);
  if (!user) throw new TaskRefused(["The Office doesn't know which user asked for this."]);
  return { user, person: by.kind === "person" ? by : undefined };
}

/** What a Start over did to the Task's branch, as Pipelines answers it. */
export interface StartingOver {
  readonly resetBranch: boolean;
  /** The branch it was reset to; undefined when it wasn't reset. */
  readonly resetTo: string | undefined;
  /** The local ref keeping the branch's old head; undefined when none was kept. */
  readonly keptRef: string | undefined;
  readonly user: UserRef;
  /** The person who started it over at the user's request; undefined when the user did. */
  readonly person?: PersonAuthor | undefined;
}

function branchResetOf({ resetTo, keptRef }: StartingOver): BranchReset | null {
  return resetTo === undefined ? null : { resetTo, keptRef: keptRef ?? null };
}

/**
 * Start over (spec 2.4.5): a Task Paused by the user's own Pause or Stop goes to `to`, not queued,
 * nothing holding it any more and its Stand-in Engines left for the next Start to choose: to Ready,
 * its Plan, Definition of Done and Pipeline kept as confirmed; to Backlog, all three Not confirmed
 * and the Task no longer planned, as `unconfirmedPlanning` leaves it (Pipelines drops its Stages
 * edited for this Task on the event). Pipelines has already left its earlier Stage runs as history
 * and, when asked, reset its branch. Its History says it started over, and where the branch was
 * reset to and its old head kept. Refused as `startOverProblems` says.
 */
export function startTaskOver(
  task: Task,
  to: StartOverTo,
  holds: WayBackHolds,
  startingOver: StartingOver,
): TaskChange<TaskStartedOver> {
  const problems = startOverProblems(task, holds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const by = byWayBack(
    startingOver.user,
    { kind: "start-over", branchReset: branchResetOf(startingOver) },
    startingOver.person,
  );
  const state: Task["state"] = to === "ready" ? "ready" : "backlog";
  const stateChanged = new TaskStateChanged(task.id, task.state, state);
  return withStateChange(
    {
      task: {
        ...task,
        ...(to === "backlog" && unconfirmedPlanning(task, PIPELINE_KEPT_AT_START_OVER)),
        state,
        pausedBy: undefined,
        ...NO_USAGE_WINDOW_RESUME,
        engineStandIns: [],
      },
      event: new TaskStartedOver(
        task.id,
        to,
        startingOver.resetBranch,
        startingOver.resetTo,
        startingOver.keptRef,
        startingOver.user,
        stateChanged,
      ),
    },
    task,
    by,
  );
}

/** How the user reopens a Task: who, when, and the Start over of a Task that had started. */
export interface Reopening {
  readonly user: UserRef;
  /** The person who reopened it at the user's request; undefined when the user did. */
  readonly person?: PersonAuthor | undefined;
  readonly at: Date;
  /** The Start over Pipelines made of a Task that had started; undefined for one that hadn't. */
  readonly startedOver: StartingOver | undefined;
}

/**
 * Reopen… (spec 2.1.3): a Dropped Task goes to Backlog or Ready, as the user asks (one of an
 * Initiative still being shaped to Shaping, its Backlog). An archived one is Restored first, as
 * Restore does, in the same save. Its drop reason leaves the Task's head, kept in the History line
 * of the move, which also says whether a Task that had started was started over and where its
 * branch was reset to. To Backlog, it is no longer planned anywhere, as a new Task isn't; to Ready,
 * its Plan, Definition of Done and Pipeline stay as confirmed. The Decisions its Drop closed stay
 * closed. Refused as `reopenProblems` says.
 */
export function reopenTask(
  task: Task,
  to: ReopenTo,
  grounds: ReopenGrounds,
  reopening: Reopening,
): TaskChange<TaskReopened> {
  const problems = reopenProblems(task, to, grounds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const { user, person, at, startedOver } = reopening;
  const state: Task["state"] =
    to === "ready" ? "ready" : grounds.initiative?.state === "shaping" ? "shaping" : "backlog";
  const restored = restoreTask(task, at, person ?? { kind: "user", user });
  const from = restored?.task ?? task;
  const planning: Partial<Task> =
    state === "ready"
      ? {}
      : {
          autoMode: false,
          initiativePlanningThreadId: undefined,
          markedPlanned: false,
          hasPlanningThread: false,
        };
  const by = byWayBack(
    user,
    {
      kind: "reopen",
      droppedAs: task.dropReason ?? null,
      startedOver: startedOver ? { branchReset: branchResetOf(startedOver) } : null,
    },
    person,
  );
  const stateChanged = new TaskStateChanged(task.id, task.state, state);
  return withStateChange(
    {
      task: { ...from, ...planning, state, dropReason: undefined },
      event: new TaskReopened(
        task.id,
        to,
        startedOver?.resetBranch ?? false,
        startedOver !== undefined,
        startedOver?.resetTo,
        startedOver?.keptRef,
        user,
        stateChanged,
        restored?.event,
      ),
    },
    task,
    by,
  );
}

/** What the user chose, before the all clear, for a Task the fire alarm paused (spec §2.8). */
export type AllClearChoice = "resume" | "hold" | "drop";

/**
 * The all clear for a Task the fire alarm paused: Resume takes it In progress, where its Pipeline
 * was held; Hold leaves it Paused as the user's own Pause; Drop drops it. Undefined for any other
 * Task, which the alarm doesn't hold.
 */
export function giveTaskAllClear(
  task: Task,
  choice: AllClearChoice,
  by: Author,
): TaskChange<TaskResumed | TaskHeldAtAllClear | TaskStateChanged> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "alarm") return undefined;
  switch (choice) {
    case "resume":
      return resumed(task, by);
    case "hold":
      return { task: { ...task, pausedBy: undefined }, event: new TaskHeldAtAllClear(task.id) };
    case "drop":
      return changeTaskState(task, "dropped", by);
  }
}

function refuseUnlessRunning(task: Task, verb: "paused" | "stopped"): void {
  if (task.state === "in-progress" || task.state === "waiting-on-you") return;
  throw new TaskRefused([
    `Only a Task in progress can be ${verb}; this one is in ${TASK_STATE_NAMES[task.state]}.`,
  ]);
}

/**
 * Drop, by the user or a person, with the reason given, if any (drop-reason.ts): the reason and the
 * move are one change, so they are saved together. Undefined when the Task is Dropped already. A
 * person (an Agent's drop_task) Drops only a Task that hasn't started; one that has is the user's
 * to Drop.
 */
export function dropTask(
  task: Task,
  by: StateChangeCause,
  reason?: DropReason,
): TaskChange<TaskStateChanged> | undefined {
  if (by.kind === "person" && STARTED_STATES.includes(task.state)) {
    throw new TaskRefused([startedTaskDropWords(task.title)]);
  }
  if (reason) {
    const problems = dropReasonProblems(task.id, reason);
    if (problems.length > 0) throw new TaskRefused(problems);
  }
  const dropped = changeTaskState(task, "dropped", by);
  if (!dropped || !reason) return dropped;
  return { ...dropped, task: { ...dropped.task, dropReason: keptDropReason(reason) } };
}

/**
 * A Decision The Office put to the user or a duty holder, answered with Drop: by the user, or by the
 * Consultant whose Role holds the duty the Decision went to.
 */
export interface DropAnswer {
  readonly decisionId: string;
  readonly by: Author;
}

/**
 * Drop as a Decision's answer (spec 2.1.3, "Dropping"): the one exception to a person Dropping only
 * unstarted work, since The Office asked them on the user's behalf. Only Pipelines' answered
 * Decisions reach it, never a route or an Office action.
 */
export function dropTaskAsAnswered(
  task: Task,
  answer: DropAnswer,
): TaskChange<TaskStateChanged> | undefined {
  return changeTaskState(task, "dropped", answer.by);
}

/** Why a person can't Drop a started Task: only the user Drops one. */
export function startedTaskDropWords(title: string): string {
  return `"${title}" has started, so only the user Drops it: ask them to.`;
}

/** A Task's Kind and bug details change in any state but Done and Dropped, never moving it. */
function refuseOnceEnded(task: Task, what: string): void {
  if (task.state === "done" || task.state === "dropped") {
    throw new TaskRefused([`A Task keeps its ${what} once it is Done or Dropped.`]);
  }
}

/** Feature, Bug or Chore, in any state but Done and Dropped; undefined when it already is. */
export function changeKind(task: Task, kind: TaskKind): TaskChange<TaskKindChanged> | undefined {
  refuseOnceEnded(task, "Kind");
  if (task.kind === kind) return undefined;
  return { task: { ...task, kind }, event: new TaskKindChanged(task.id, kind) };
}

/**
 * The Task whose work caused this Bug: any other Task, in any Project and any state (a cycle is
 * allowed), or undefined for none. Undefined when it already names it.
 */
export function changeCausedBy(
  task: Task,
  causedBy: string | undefined,
): TaskChange<TaskBugDetailsChanged> | undefined {
  refuseOnceEnded(task, "bug details");
  if (causedBy === task.id) throw new TaskRefused(["A Task can't be caused by itself."]);
  if (task.causedBy === causedBy) return undefined;
  return { task: { ...task, causedBy }, event: new TaskBugDetailsChanged(task.id) };
}

/** The most a Found in version may hold, trimmed. */
export const MAX_FOUND_IN_VERSION = 64;

/**
 * The version the Bug was found in, free text, trimmed, 1 to 64 characters, or undefined for none.
 * Undefined when it already reads so.
 */
export function changeFoundInVersion(
  task: Task,
  given: string | undefined,
): TaskChange<TaskBugDetailsChanged> | undefined {
  refuseOnceEnded(task, "bug details");
  const foundInVersion = given?.trim();
  if (foundInVersion !== undefined && !between(foundInVersion.length, 1, MAX_FOUND_IN_VERSION)) {
    throw new TaskRefused([`Found in version is 1 to ${MAX_FOUND_IN_VERSION} characters.`]);
  }
  if (task.foundInVersion === foundInVersion) return undefined;
  return { task: { ...task, foundInVersion }, event: new TaskBugDetailsChanged(task.id) };
}

function between(value: number, least: number, most: number): boolean {
  return value >= least && value <= most;
}

/** Undefined when the Task already has that priority. */
export function changePriority(
  task: Task,
  priority: Priority,
): TaskChange<TaskPriorityChanged> | undefined {
  if (task.priority === priority) return undefined;
  return { task: { ...task, priority }, event: new TaskPriorityChanged(task.id, priority) };
}

/**
 * Moves a Task that hasn't started between two neighbours in its column, given every other
 * Task's key on the board. Undefined when it already stands there; a drop into another column is
 * refused, since a state changes only through the Task's actions.
 */
export function reorderTask(
  task: Task,
  neighbours: Neighbours,
  takenOrders: readonly string[],
): TaskChange<TaskReordered> | undefined {
  const problems = reorderProblems(task, neighbours);
  if (problems.length > 0) throw new TaskRefused(problems);
  const { above, below } = neighbours;
  const alreadyThere =
    (!above || boardOrder(above, task) < 0) && (!below || boardOrder(task, below) < 0);
  if (alreadyThere) return undefined;
  const placement = placementBetween(task, neighbours, takenOrders);
  return {
    task: { ...task, ...placement },
    event: new TaskReordered(task.id, placement.priority, placement.order),
  };
}

function reorderProblems(task: Task, { above, below }: Neighbours): string[] {
  if (!NOT_STARTED_STATES.includes(task.state)) {
    return ["A Task keeps its place on the board once it has started."];
  }
  const others = [above, below].filter((other) => other !== undefined);
  if (others.some((other) => other.id === task.id)) {
    return ["A Task can't be placed next to itself."];
  }
  if (others.some((other) => other.state !== task.state)) {
    return ["A Task changes state through its actions: Plan, Mark Ready, Start."];
  }
  if (above && below && boardOrder(above, below) >= 0) {
    return ["The Tasks around the drop are not next to each other on the board."];
  }
  return [];
}
