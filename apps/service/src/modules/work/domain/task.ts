import type { Author } from "./author.js";
import { normalizedTags, tagsProblems } from "./task-tags.js";
import { titleProblem } from "./title.js";

/**
 * Backlog → Planning → Ready → In progress → Done, with Waiting on you and Paused beside In
 * progress and Dropped as the exit, and Shaping before Backlog for a Task of an Initiative not yet
 * confirmed (spec §2.1); the moves between them are in task-states.ts.
 */
export const TASK_STATES = [
  "shaping",
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

/**
 * The Tasks The Office makes for a Project by itself: its Onboard Task, and its "Set up the run
 * environment" Task.
 */
export const TASK_MADE_FOR = ["onboard", "run-environment-setup"] as const;
export type TaskMadeFor = (typeof TASK_MADE_FOR)[number];

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
  /** Free-form words to find and filter it by, normalized and unique (task-tags.ts). */
  readonly tags: readonly string[];
  /** Its place in the board's manual order, a key compared as plain strings (manual-order.ts). */
  readonly order: string;
  /** What the user wants, in their own words; empty when the title is all there is. */
  readonly description: string;
  /** How it will be done; empty until planned. */
  readonly plan: string;
  /** Whether the user confirmed the Plan as it stands; the Planner's writing leaves it proposed. */
  readonly planConfirmed: boolean;
  /**
   * The files and folders the Plan expects to change (files-to-change.ts), written and confirmed
   * with it; Start weighs an Overlap on them.
   */
  readonly filesToChange: readonly string[];
  /**
   * The Planner's estimate of the tokens the whole Pipeline will use, written and confirmed with
   * the Plan; a Usage estimate falls back on it below 3 done Tasks.
   */
  readonly estimatedTokens: number | undefined;
  /** What must be true when it is done, one plain-language statement each. */
  readonly definitionOfDone: readonly string[];
  /** As `planConfirmed`, for the Definition of Done. */
  readonly definitionOfDoneConfirmed: boolean;
  /** The Pipeline its work follows; its own Stages, once it has them, are kept by Pipelines. */
  readonly pipelineId: string;
  /** The Pipeline the Planner proposes, until the user confirms it or chooses another. */
  readonly proposedPipeline: ProposedPipeline | undefined;
  /**
   * Whether it is planned in auto mode: chosen at Make a plan, off with Plan with…, and counted only
   * while it is in Planning. Once the Planner marks it planned with no Decision open, The Office
   * confirms what is unconfirmed and marks it Ready (`acceptInAutoMode`).
   */
  readonly autoMode: boolean;
  /**
   * The Initiative's planning Thread it is planned in, from its move to Planning there (Plan the
   * Initiative's start_planning); undefined when it is planned in a Thread of its own, or not at all.
   * That Thread counts as its planning Thread: it has none of its own and no worktree meanwhile.
   */
  readonly initiativePlanningThreadId: string | undefined;
  /** Whether the Planner marked it planned (mark_planned) since it last moved to Planning. */
  readonly markedPlanned: boolean;
  /**
   * The Role whose person's Task limit it counts against from Start on: the Role of its Pipeline's
   * first Agent Stage, as the click-through counts; undefined before Start or without one.
   */
  readonly personRole: string | undefined;
  /**
   * Whether the fire alarm holds it Paused (spec §2.8), apart from a Pause of the user's own: the
   * all clear resumes it, or the user's Hold makes it theirs.
   */
  readonly pausedByAlarm: boolean;
  /**
   * What The Office made it for, in its Project: its Onboard Task, whose state is the Project's
   * onboarding, or its "Set up the run environment" Task; undefined for any other Task.
   */
  readonly madeFor: TaskMadeFor | undefined;
  /**
   * The Tasks that must be Done before it can start, in any Project, in the order they were added
   * (task-dependencies.ts); a Dropped one stays listed but no longer blocks.
   */
  readonly blockedBy: readonly string[];
  /** The Idea it was shaped from, if it was. */
  readonly originIdeaId: string | undefined;
  /** The Initiative it is part of, if any; it stays there for good. */
  readonly initiativeId: string | undefined;
  /** Each Move to another Project, oldest first (task-move.ts). */
  readonly projectMoves: readonly ProjectMove[];
  readonly createdBy: Author;
  readonly createdAt: Date;
  /**
   * When it was archived, while it is (task-archive.ts): a mark on a Done or Dropped Task that takes
   * it off the board, never a state, so everything reading its state reads it as before.
   */
  readonly archivedAt: Date | undefined;
  /** When it was last restored from the Archive, kept for archiving it again automatically. */
  readonly restoredAt: Date | undefined;
}

/** A Task's Move from one Project to another, kept for its record. */
export interface ProjectMove {
  readonly from: string;
  readonly to: string;
  readonly at: Date;
  readonly by: Author;
}

/** A Pipeline the Planner chose from the Definition of Done, with why (spec §2.3). */
export interface ProposedPipeline {
  readonly pipelineId: string;
  readonly reason: string;
}

/** What creating a Task takes from whoever asks; The Office sets the rest. */
export type NewTask = Pick<Task, "title" | "projectId" | "priority"> &
  Partial<Pick<Task, "description" | "tags">>;

/**
 * A new Task as given, trimmed, with its Tags normalized: no Description and no Tags when none
 * were given.
 */
export function trimmedNewTask(task: NewTask): Required<NewTask> {
  return {
    title: task.title.trim(),
    description: (task.description ?? "").trim(),
    projectId: task.projectId,
    priority: task.priority,
    tags: normalizedTags(task.tags ?? []),
  };
}

/** Why a new Task can't be created; that its Project exists is checked by the caller. */
export function newTaskProblems(task: NewTask): string[] {
  const problem = titleProblem(task.title, "Task");
  return [...(problem ? [problem] : []), ...tagsProblems(normalizedTags(task.tags ?? []))];
}
