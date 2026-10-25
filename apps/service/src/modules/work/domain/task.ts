import type { Author } from "./author.js";
import { titleProblem } from "./title.js";

/**
 * Backlog → Planning → Ready → In progress → Done, with Waiting on you and Paused beside In
 * progress and Dropped as the exit (spec §2.1); the moves between them are in task-states.ts.
 */
export const TASK_STATES = [
  "backlog",
  "planning",
  "ready",
  "in-progress",
  "waiting-on-you",
  "paused",
  "done",
  "dropped",
] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Highest first: the board shows each column by priority, then by manual order. */
export const PRIORITIES = ["high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** One unit of work in one Project, done when its Definition of Done is met. */
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  readonly state: TaskState;
  readonly priority: Priority;
  /** Its place in the board's manual order, a key compared as plain strings (manual-order.ts). */
  readonly order: string;
  /** How it will be done; empty until planned. */
  readonly plan: string;
  /** What must be true when it is done, one plain-language statement each. */
  readonly definitionOfDone: readonly string[];
  /** The Pipeline its work follows; its own Stages, once it has them, are kept by Pipelines. */
  readonly pipelineId: string;
  /** The Idea it was shaped from, if it was. */
  readonly originIdeaId: string | undefined;
  readonly createdBy: Author;
  readonly createdAt: Date;
}

/** What creating a Task takes from whoever asks; The Office sets the rest. */
export type NewTask = Pick<Task, "title" | "projectId" | "priority">;

export function trimmedNewTask(task: NewTask): NewTask {
  return { title: task.title.trim(), projectId: task.projectId, priority: task.priority };
}

/** Why a new Task can't be created; that its Project exists is checked by the caller. */
export function newTaskProblems(task: NewTask): string[] {
  const problem = titleProblem(task.title, "Task");
  return problem ? [problem] : [];
}
