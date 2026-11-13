import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { THE_USER, type Author } from "./author.js";
import { boardOrder, placementBetween, type Neighbours } from "./manual-order.js";
import { newTaskProblems, trimmedNewTask, type NewTask, type Priority, type Task } from "./task.js";
import {
  TaskCreated,
  TaskHeldAtAllClear,
  TaskPaused,
  TaskPriorityChanged,
  TaskReordered,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
  type UsageWindowRefusal,
} from "./task-events.js";
import { FIRE_ALARM_ON } from "./fire-alarm.js";
import { THE_PLANNER } from "./planning.js";
import {
  BY_THE_FIRE_ALARM,
  BY_THE_PIPELINE,
  BY_THE_USAGE_WINDOW,
  type StateChange,
  type StateChangeCause,
} from "./state-change.js";
import { TaskRefused } from "./task-refused.js";
import { writtenParts, type WrittenPlanAndDefinitionOfDone } from "./written-parts.js";
import {
  NOT_STARTED_STATES,
  STARTED_STATES,
  TASK_STATE_NAMES,
  openDecisionProblems,
  stateChangeProblems,
} from "./task-states.js";

/**
 * A Task after a change, with the event that announces it, and the move between states it makes,
 * kept with the Task as it is saved.
 */
export interface TaskChange<Event extends DomainEvent> {
  readonly task: Task;
  readonly event: Event;
  readonly stateChange?: StateChange;
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

/** What The Office sets on a new Task. */
export interface NewTaskSetting {
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
    pipelineId: undefined,
    proposedPipeline: undefined,
    autoMode: false,
    initiativePlanningThreadId: undefined,
    markedPlanned: false,
    hasPlanningThread: false,
    personRole: undefined,
    pausedBy: undefined,
    resumesAt: undefined,
    madeFor: undefined,
    blockedBy: [],
    originIdeaId: setting.originIdeaId,
    initiativeId: setting.initiativeId,
    projectMoves: [],
    createdBy: setting.createdBy,
    createdAt,
    archivedAt: undefined,
    restoredAt: undefined,
    endedAt: undefined,
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
  return withStateChange(
    {
      task: { ...task, state: to, pausedBy: undefined, resumesAt: undefined },
      event: new TaskStateChanged(task.id, task.state, to),
    },
    task,
    by,
  );
}

/**
 * Where a Task is planned: in a planning Thread of its own, moved there by the user, or in its
 * Initiative's planning Thread, moved there by the Planner as its turn comes (start_planning).
 */
export type PlanningThread =
  { readonly kind: "own" } | { readonly kind: "initiative"; readonly threadId: string };

export const OWN_PLANNING_THREAD: PlanningThread = { kind: "own" };

/**
 * Backlog → Planning, in auto mode or not and in the Thread it is planned in, set in the same save
 * so the move and those never drift apart; not marked planned, whatever an earlier planning left.
 * Undefined when the Task is in Planning already, keeping what it has.
 */
export function startPlanningTask(
  task: Task,
  autoMode: boolean,
  thread: PlanningThread = OWN_PLANNING_THREAD,
): TaskChange<TaskStateChanged> | undefined {
  const by: StateChangeCause = thread.kind === "own" ? THE_USER : THE_PLANNER;
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
export function moveToBacklogOnConfirm(task: Task): TaskChange<TaskStateChanged> {
  return withStateChange(
    {
      task: { ...task, state: "backlog" },
      event: new TaskStateChanged(task.id, task.state, "backlog"),
    },
    task,
    THE_USER,
  );
}

/**
 * Mark Ready: Backlog or Planning → Ready, refused with every reason, those of the Task's record and the
 * Decisions on it still open; by the user, or by auto mode on their behalf. Undefined when the Task
 * is Ready already.
 */
export function markTaskReady(
  task: Task,
  openDecisions: number,
  by: StateChangeCause = THE_USER,
): TaskChange<TaskStateChanged> | undefined {
  if (task.state === "ready") return undefined;
  const problems = [...stateChangeProblems(task, "ready"), ...openDecisionProblems(openDecisions)];
  if (problems.length > 0) throw new TaskRefused(problems);
  return changeTaskState(task, "ready", by);
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
      task: { ...task, state: "paused", pausedBy: undefined, resumesAt: undefined },
      event: new TaskPaused(task.id, task.state),
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
 * reset, its Stage's run already ended held. One paused by the usage window has its resume moved to
 * the new reset. Undefined for any other: a Task the user, the alarm or its Initiative holds stays
 * theirs.
 */
export function pauseTaskForUsageWindow(
  task: Task,
  refusal: UsageWindowRefusal,
): TaskChange<TaskPaused> | undefined {
  const pausedByTheWindow = task.state === "paused" && task.pausedBy === "usage-window";
  if (!pausedByTheWindow && task.state !== "in-progress" && task.state !== "waiting-on-you") {
    return undefined;
  }
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: "usage-window", resumesAt: refusal.resetsAt },
      event: new TaskPaused(task.id, task.state, "usage-window", refusal),
    },
    task,
    BY_THE_USAGE_WINDOW,
  );
}

/**
 * The usage window's reset, for a Task it paused: the Task goes on In progress, where its Pipeline
 * was held, or, while the fire alarm is on, is held by the alarm until the all clear, as a Resume
 * then is. Undefined for any other Task, and before its reset.
 */
export function resumeTaskAtReset(
  task: Task,
  { fireAlarmOn, now }: { readonly fireAlarmOn: boolean; readonly now: Date },
): TaskChange<TaskResumed | TaskPaused> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "usage-window") return undefined;
  if (task.resumesAt !== undefined && task.resumesAt > now) return undefined;
  if (fireAlarmOn) {
    return {
      task: { ...task, pausedBy: "alarm", resumesAt: undefined },
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
export function stopTask(task: Task): TaskChange<TaskStopped> {
  if (task.state !== "paused") refuseUnlessRunning(task, "stopped");
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: undefined, resumesAt: undefined },
      event: new TaskStopped(task.id, task.state),
    },
    task,
    THE_USER,
  );
}

/**
 * Pause the Initiative, for one of its Tasks (spec §2.1): one In progress or Waiting on you is held
 * Paused by the Initiative, its running Stage once the Agent's current turn ends, and one the fire
 * alarm or the usage window holds becomes the Initiative's, so neither the all clear nor the reset
 * resumes it; the usage window's reset is kept for Resume the Initiative. Undefined for any other:
 * a Task the user paused stays theirs.
 */
export function pauseTaskForInitiative(task: Task): TaskChange<TaskPaused> | undefined {
  if (task.state === "paused") {
    if (task.pausedBy !== "alarm" && task.pausedBy !== "usage-window") return undefined;
    return {
      task: { ...task, pausedBy: "initiative" },
      event: new TaskPaused(task.id, "paused", "initiative"),
    };
  }
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return undefined;
  return withStateChange(
    {
      task: { ...task, state: "paused", pausedBy: "initiative" },
      event: new TaskPaused(task.id, task.state, "initiative"),
    },
    task,
    THE_USER,
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
  { fireAlarmOn, now }: { readonly fireAlarmOn: boolean; readonly now: Date },
): TaskChange<TaskResumed | TaskPaused> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "initiative") return undefined;
  if (task.resumesAt !== undefined && task.resumesAt > now) {
    return {
      task: { ...task, pausedBy: "usage-window" },
      event: new TaskPaused(task.id, "paused", "usage-window"),
    };
  }
  if (fireAlarmOn) {
    return {
      task: { ...task, pausedBy: "alarm", resumesAt: undefined },
      event: new TaskPaused(task.id, "paused", "alarm"),
    };
  }
  return resumed(task);
}

/** Why a single Resume is refused while the Task's Initiative is paused. */
export const INITIATIVE_PAUSED_RESUME = "The Initiative is paused: resume it to go on.";

/**
 * Resume: a Paused Task goes on In progress, where its Pipeline was held. While the fire alarm is
 * on, nothing walks (the user's answer of 2026-10-29): the Resume is kept as the alarm holding the
 * Task, which the all clear resumes. While its Initiative is paused, only Resume the Initiative
 * resumes it.
 */
export function resumeTask(
  task: Task,
  {
    fireAlarmOn,
    initiativePaused,
  }: { readonly fireAlarmOn: boolean; readonly initiativePaused: boolean },
): TaskChange<TaskResumed | TaskPaused> {
  if (task.state !== "paused") {
    throw new TaskRefused([
      `Only a Paused Task can be resumed; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (initiativePaused) throw new TaskRefused([INITIATIVE_PAUSED_RESUME]);
  if (!fireAlarmOn) return resumed(task);
  if (task.pausedBy === "alarm") {
    throw new TaskRefused([`${FIRE_ALARM_ON} The Task resumes with the all clear.`]);
  }
  return {
    task: { ...task, pausedBy: "alarm", resumesAt: undefined },
    event: new TaskPaused(task.id, "paused", "alarm"),
  };
}

function resumed(task: Task, by: StateChangeCause = THE_USER): TaskChange<TaskResumed> {
  return withStateChange(
    {
      task: { ...task, state: "in-progress", pausedBy: undefined, resumesAt: undefined },
      event: new TaskResumed(task.id),
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
): TaskChange<TaskResumed | TaskHeldAtAllClear | TaskStateChanged> | undefined {
  if (task.state !== "paused" || task.pausedBy !== "alarm") return undefined;
  switch (choice) {
    case "resume":
      return resumed(task);
    case "hold":
      return { task: { ...task, pausedBy: undefined }, event: new TaskHeldAtAllClear(task.id) };
    case "drop":
      return changeTaskState(task, "dropped", THE_USER);
  }
}

function refuseUnlessRunning(task: Task, verb: "paused" | "stopped"): void {
  if (task.state === "in-progress" || task.state === "waiting-on-you") return;
  throw new TaskRefused([
    `Only a Task in progress can be ${verb}; this one is in ${TASK_STATE_NAMES[task.state]}.`,
  ]);
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
