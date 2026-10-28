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
  /** Whether the user confirmed the Plan as it stands; the Planner's writing leaves it proposed. */
  readonly planConfirmed: boolean;
  /** What must be true when it is done, one plain-language statement each. */
  readonly definitionOfDone: readonly string[];
  /** As `planConfirmed`, for the Definition of Done. */
  readonly definitionOfDoneConfirmed: boolean;
  /** The Pipeline its work follows; its own Stages, once it has them, are kept by Pipelines. */
  readonly pipelineId: string;
  /** The Pipeline the Planner proposes, until the user confirms it or chooses another. */
  readonly proposedPipeline: ProposedPipeline | undefined;
  /**
   * The Role whose person's Task limit it counts against from Start on: the Role of its Pipeline's
   * first Agent Stage, as the click-through counts; undefined before Start or without one.
   */
  readonly personRole: string | undefined;
  /**
   * The Tasks that must be Done before it can start, in any Project, in the order they were added
   * (task-dependencies.ts); a Dropped one stays listed but no longer blocks.
   */
  readonly blockedBy: readonly string[];
  /** The Idea it was shaped from, if it was. */
  readonly originIdeaId: string | undefined;
  /** The Initiative it is part of, if any; it stays there for good. */
  readonly initiativeId: string | undefined;
  readonly createdBy: Author;
  readonly createdAt: Date;
}

/** A Pipeline the Planner chose from the Definition of Done, with why (spec §2.3). */
export interface ProposedPipeline {
  readonly pipelineId: string;
  readonly reason: string;
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
