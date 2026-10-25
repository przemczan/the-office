import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Author } from "./author.js";
import { boardOrder, placementBetween, type Neighbours } from "./manual-order.js";
import { newTaskProblems, trimmedNewTask, type NewTask, type Priority, type Task } from "./task.js";
import {
  TaskCreated,
  TaskPriorityChanged,
  TaskReordered,
  TaskStateChanged,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, stateChangeProblems } from "./task-states.js";

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
    definitionOfDone: [],
    pipelineId: setting.pipelineId,
    originIdeaId: setting.originIdeaId,
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
  return { task: { ...task, state: to }, event: new TaskStateChanged(task.id, task.state, to) };
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
 * Moves a Task that hasn't started between two neighbours in its column. Undefined when it
 * already stands there; a drop into another column is refused, since a state changes only
 * through the Task's actions.
 */
export function reorderTask(
  task: Task,
  neighbours: Neighbours,
): TaskChange<TaskReordered> | undefined {
  const problems = reorderProblems(task, neighbours);
  if (problems.length > 0) throw new TaskRefused(problems);
  const { above, below } = neighbours;
  const alreadyThere =
    (!above || boardOrder(above, task) < 0) && (!below || boardOrder(task, below) < 0);
  if (alreadyThere) return undefined;
  const placement = placementBetween(task, neighbours);
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
