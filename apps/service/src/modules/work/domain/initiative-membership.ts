import type { Author } from "./author.js";
import { pipelineIn, type Initiative } from "./initiative.js";
import { unfinishedPublishingTask } from "./publishing-task.js";
import { isPublishingTask, type Task, type TaskMadeFor, type TaskState } from "./task.js";
import { isArchived } from "./task-archive.js";
import { withStateChange, type TaskChange } from "./task-changes.js";
import { blockPublishingTask, removeDependency } from "./task-dependencies.js";
import {
  TaskAddedToInitiative,
  TaskStateChanged,
  TaskTakenOutOfInitiative,
  type TaskDependencyAdded,
  type TaskDependencyRemoved,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/**
 * A Task joining or leaving an Initiative (spec 2.1, "Initiatives"), with the change it makes to
 * the Initiative's Publishing Task in the Task's Project, if any.
 */
export interface InitiativeMembershipChange<
  Event extends TaskAddedToInitiative | TaskTakenOutOfInitiative,
> {
  readonly task: TaskChange<Event>;
  readonly publishing: TaskChange<TaskDependencyAdded | TaskDependencyRemoved> | undefined;
}

/** What a membership change is judged on besides the records: read holding the Task. */
export interface MembershipGrounds {
  /** Whether the Task's worktree is there, made from what its branch started from then. */
  readonly worktreeExists: boolean;
}

const MADE_FOR_WORDS: Readonly<Record<TaskMadeFor, string>> = {
  onboard: "a Project's Onboard Task",
  "run-environment-setup": "a Project's Set up the run environment Task",
  publishing: "an Initiative's Publishing Task",
};

/**
 * An existing Task joins the Initiative, by the user or a person whose duty covers it: a Task is in
 * at most one Initiative, joins before it starts and isn't one The Office made; the Initiative is
 * being shaped or active. Joining one being shaped moves a Backlog Task to Shaping, as Confirm will
 * move its Tasks on; joining an active one keeps its state. The Initiative's unfinished Publishing
 * Task in the Task's Project waits for it, as it waits for each of its Tasks there. Undefined when it
 * is in the Initiative already; refused with every reason. `tasks` are every Task.
 */
export function addToInitiative(
  initiative: Initiative,
  task: Task,
  tasks: readonly Task[],
  grounds: MembershipGrounds,
  by: Author,
): InitiativeMembershipChange<TaskAddedToInitiative> | undefined {
  if (task.initiativeId === initiative.id) return undefined;
  const problems = joiningProblems(initiative, task, grounds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const state: TaskState = initiative.state === "shaping" ? "shaping" : task.state;
  const joined = withStateChange(
    {
      task: { ...task, initiativeId: initiative.id, state },
      event: new TaskAddedToInitiative(task.id, initiative.id, stateChangedOf(task, state)),
    },
    task,
    by,
  );
  const publishing = unfinishedPublishingTask(
    tasks.filter(({ initiativeId }) => initiativeId === initiative.id),
    task.projectId,
  );
  const withJoined = tasks.map((each) => (each.id === task.id ? joined.task : each));
  return {
    task: joined,
    publishing: publishing && blockPublishingTask(publishing, task.id, withJoined),
  };
}

/**
 * The Task leaves the Initiative before it starts, by the user or a person whose duty covers it; a
 * Publishing Task never does. One in Shaping goes to Backlog; one planned in the Initiative's
 * planning Thread loses it and, having no planning Thread of its own, goes to Backlog from Planning
 * as a changing Save on it would, or stays Ready, then going to Backlog on such a Save. The
 * Publishing Task in its Project stops waiting for it; its other dependencies stay. Refused with
 * every reason. `tasks` are every Task.
 */
export function takeOutOfInitiative(
  initiative: Initiative,
  task: Task,
  tasks: readonly Task[],
  grounds: MembershipGrounds,
  by: Author,
): InitiativeMembershipChange<TaskTakenOutOfInitiative> {
  const problems = leavingProblems(initiative, task, grounds);
  if (problems.length > 0) throw new TaskRefused(problems);
  const plannedInInitiative = task.initiativePlanningThreadId !== undefined;
  const state: TaskState =
    task.state === "shaping" || (task.state === "planning" && plannedInInitiative)
      ? "backlog"
      : task.state;
  const left = withStateChange(
    {
      task: {
        ...task,
        initiativeId: undefined,
        state,
        ...(plannedInInitiative && {
          initiativePlanningThreadId: undefined,
          hasPlanningThread: false,
          markedPlanned: state === "backlog" ? false : task.markedPlanned,
        }),
      },
      event: new TaskTakenOutOfInitiative(task.id, initiative.id, stateChangedOf(task, state)),
    },
    task,
    by,
  );
  const publishing = unfinishedPublishingTask(
    tasks.filter(({ initiativeId }) => initiativeId === initiative.id),
    task.projectId,
  );
  return { task: left, publishing: publishing && removeDependency(publishing, task.id) };
}

function joiningProblems(initiative: Initiative, task: Task, grounds: MembershipGrounds): string[] {
  const problems = [...madeByTheOfficeProblems(task), ...notStartedProblems(task, "joins")];
  if (task.initiativeId !== undefined) {
    problems.push(
      `"${task.title}" is in another Initiative already, and a Task is in at most one: take it out of that one first.`,
    );
  }
  if (initiative.state === "done" || initiative.state === "dropped") {
    problems.push(`A ${initiative.state} Initiative takes no more Tasks.`);
  } else if (initiative.state === "shaping" && task.state !== "backlog") {
    problems.push(
      `Only a Task in Backlog joins an Initiative being shaped; "${task.title}" is in ${TASK_STATE_NAMES[task.state]}.`,
    );
  }
  if (grounds.worktreeExists && pipelineIn(initiative, task.projectId) !== undefined) {
    problems.push(
      `"${task.title}" has a worktree made from the base branch, and the Initiative's Tasks in ${task.projectId} work from its branch there.`,
    );
  }
  return problems;
}

function leavingProblems(initiative: Initiative, task: Task, grounds: MembershipGrounds): string[] {
  if (task.initiativeId !== initiative.id) {
    return [`"${task.title}" isn't in the Initiative "${initiative.name}".`];
  }
  const problems = [...madeByTheOfficeProblems(task), ...notStartedProblems(task, "leaves")];
  if (grounds.worktreeExists && pipelineIn(initiative, task.projectId) !== undefined) {
    problems.push(
      `"${task.title}" has a worktree made from the Initiative's branch, so it stays in the Initiative.`,
    );
  }
  return problems;
}

function madeByTheOfficeProblems(task: Task): string[] {
  if (task.madeFor === undefined) return [];
  return isPublishingTask(task)
    ? [`"${task.title}" is ${MADE_FOR_WORDS.publishing}, which stays with its Initiative.`]
    : [`"${task.title}" is ${MADE_FOR_WORDS[task.madeFor]}, which belongs to no Initiative.`];
}

function notStartedProblems(task: Task, move: "joins" | "leaves"): string[] {
  const where = move === "joins" ? "joins an Initiative" : "leaves its Initiative";
  if (isArchived(task)) return [`"${task.title}" is archived.`];
  if (NOT_STARTED_STATES.includes(task.state)) return [];
  return [`A Task ${where} before it starts; "${task.title}" is ${TASK_STATE_NAMES[task.state]}.`];
}

function stateChangedOf(task: Task, to: TaskState): TaskStateChanged | undefined {
  return to === task.state ? undefined : new TaskStateChanged(task.id, task.state, to);
}
