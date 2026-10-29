import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Author } from "./author.js";
import { boardOrder, placementBetween, type Neighbours } from "./manual-order.js";
import { newTaskProblems, trimmedNewTask, type NewTask, type Priority, type Task } from "./task.js";
import {
  TaskCreated,
  TaskPaused,
  TaskPriorityChanged,
  TaskReordered,
  TaskResumed,
  TaskStateChanged,
  TaskStopped,
} from "./task-events.js";
import { FIRE_ALARM_ON } from "./fire-alarm.js";
import { TaskRefused } from "./task-refused.js";
import {
  NOT_STARTED_STATES,
  STARTED_STATES,
  TASK_STATE_NAMES,
  openDecisionProblems,
  stateChangeProblems,
} from "./task-states.js";

/** A Task after a change, with the event that announces it. */
export interface TaskChange<Event extends DomainEvent> {
  readonly task: Task;
  readonly event: Event;
}

/** What The Office sets on a new Task: its Pipeline comes from the Project's default. */
export interface NewTaskSetting {
  readonly pipelineId: string;
  readonly order: string;
  readonly originIdeaId: string | undefined;
  readonly initiativeId: string | undefined;
  readonly createdBy: Author;
}

/** A new Task starts in Backlog, unplanned. Refuses with every reason. */
export function createTask(
  id: string,
  given: NewTask,
  setting: NewTaskSetting,
  createdAt: Date,
): TaskChange<TaskCreated> {
  const newTask = trimmedNewTask(given);
  const problems = newTaskProblems(newTask);
  if (problems.length > 0) throw new TaskRefused(problems);
  const task: Task = {
    id,
    ...newTask,
    state: "backlog",
    order: setting.order,
    plan: "",
    planConfirmed: false,
    filesToChange: [],
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    pipelineId: setting.pipelineId,
    proposedPipeline: undefined,
    personRole: undefined,
    pausedByAlarm: false,
    isOnboardTask: false,
    blockedBy: [],
    originIdeaId: setting.originIdeaId,
    initiativeId: setting.initiativeId,
    createdBy: setting.createdBy,
    createdAt,
  };
  return { task, event: new TaskCreated(task) };
}

/** Undefined when the Task is already there; refused when the move breaks the state rules. */
export function changeTaskState(
  task: Task,
  to: Task["state"],
): TaskChange<TaskStateChanged> | undefined {
  const problems = stateChangeProblems(task, to);
  if (problems.length > 0) throw new TaskRefused(problems);
  if (task.state === to) return undefined;
  return {
    task: { ...task, state: to, pausedByAlarm: false },
    event: new TaskStateChanged(task.id, task.state, to),
  };
}

/**
 * Planning → Backlog, when planning couldn't begin: a Task is never in Planning without its
 * planning Thread. Undefined when the Task has already left Planning.
 */
export function undoPlanningMove(task: Task): TaskChange<TaskStateChanged> | undefined {
  if (task.state !== "planning") return undefined;
  return {
    task: { ...task, state: "backlog" },
    event: new TaskStateChanged(task.id, "planning", "backlog"),
  };
}

/**
 * Mark Ready: Planning → Ready, refused with every reason, those of the Task's record and the
 * Decisions on it still open. Undefined when the Task is Ready already.
 */
export function markTaskReady(
  task: Task,
  openDecisions: number,
): TaskChange<TaskStateChanged> | undefined {
  if (task.state === "ready") return undefined;
  const problems = [...stateChangeProblems(task, "ready"), ...openDecisionProblems(openDecisions)];
  if (problems.length > 0) throw new TaskRefused(problems);
  return changeTaskState(task, "ready");
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
  return changeTaskState(task, to);
}

/**
 * Pause (spec §2.4): a Task In progress or Waiting on you is held as Paused, its running Stage once
 * the Agent's current turn ends. Undefined when it is Paused already.
 */
export function pauseTask(task: Task): TaskChange<TaskPaused> | undefined {
  if (task.state === "paused") return undefined;
  refuseUnlessRunning(task, "paused");
  return {
    task: { ...task, state: "paused", pausedByAlarm: false },
    event: new TaskPaused(task.id, task.state),
  };
}

/**
 * The fire alarm sounding (spec §2.8): a Task In progress or Waiting on you is held as Paused by
 * the alarm, its running Stage at its next safe point. Undefined for any other: a Task the user
 * paused stays theirs.
 */
export function pauseTaskForAlarm(task: Task): TaskChange<TaskPaused> | undefined {
  if (task.state !== "in-progress" && task.state !== "waiting-on-you") return undefined;
  return {
    task: { ...task, state: "paused", pausedByAlarm: true },
    event: new TaskPaused(task.id, task.state, "alarm"),
  };
}

/**
 * Stop (spec §2.4): as Pause, but the Stage running now is interrupted; a Task paused already can
 * still be stopped, so its Stage doesn't run to its end. The Stop is the user's, even of a Task
 * the fire alarm paused.
 */
export function stopTask(task: Task): TaskChange<TaskStopped> {
  if (task.state !== "paused") refuseUnlessRunning(task, "stopped");
  return {
    task: { ...task, state: "paused", pausedByAlarm: false },
    event: new TaskStopped(task.id, task.state),
  };
}

/**
 * Resume: a Paused Task goes on In progress, where its Pipeline was held. While the fire alarm is
 * on, nothing walks (the user's answer of 2026-10-29): the Resume is kept as the alarm holding the
 * Task, which the all clear resumes.
 */
export function resumeTask(
  task: Task,
  { fireAlarmOn }: { readonly fireAlarmOn: boolean },
): TaskChange<TaskResumed | TaskPaused> {
  if (task.state !== "paused") {
    throw new TaskRefused([
      `Only a Paused Task can be resumed; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (!fireAlarmOn) {
    return {
      task: { ...task, state: "in-progress", pausedByAlarm: false },
      event: new TaskResumed(task.id),
    };
  }
  if (task.pausedByAlarm) {
    throw new TaskRefused([`${FIRE_ALARM_ON} The Task resumes with the all clear.`]);
  }
  return {
    task: { ...task, pausedByAlarm: true },
    event: new TaskPaused(task.id, "paused", "alarm"),
  };
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
