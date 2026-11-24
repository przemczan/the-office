import type { EngineId } from "../../engine/index.js";
import type { ArchivedBy, Author } from "./author.js";
import type { BranchDeletionRecord } from "./branch-deletion.js";
import type { DropReason } from "./drop-reason.js";
import type { EngineStandIn } from "./stand-ins-at-start.js";
import type { PullRequestEnd } from "./task-pull-request.js";
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
 * The Tasks The Office makes by itself: a Project's Onboard Task, its "Set up the run
 * environment" Task and its "Set up test targets" Task, an Initiative's Publishing Task in a
 * Project (publishing-task.ts), and a Conflict resolution Task for a pull request with conflicts
 * (conflict-resolution.ts).
 */
export const TASK_MADE_FOR = [
  "onboard",
  "run-environment-setup",
  "test-targets-setup",
  "publishing",
  "resolve-conflicts",
] as const;
export type TaskMadeFor = (typeof TASK_MADE_FOR)[number];

/**
 * What holds a Paused Task apart from a Pause of the user's own: the fire alarm (spec §2.8), its
 * Initiative's Pause (spec §2.1, "Pause the Initiative"), or its engine's usage window used up, until
 * its reset (spec §2.1, "A pause by the usage window").
 */
export const TASK_HOLDERS = ["alarm", "initiative", "usage-window"] as const;
export type TaskHolder = (typeof TASK_HOLDERS)[number];

/**
 * Whether the Task is an Initiative's Publishing Task: it works on the Initiative's branch itself
 * and publishes it into the base branch (spec 2.1, "Publishing Tasks").
 */
export function isPublishingTask(task: Pick<Task, "madeFor">): boolean {
  return task.madeFor === "publishing";
}

/** A Task's Kind (spec §2.1); a new Task is a Feature unless told otherwise. */
export const TASK_KINDS = ["feature", "bug", "chore"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

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
  /**
   * The message of the one commit Publish lands the Task as (task-commit-message.ts): the Planner's
   * suggestion, updated by its Agent Stages and the user; empty when none is written, and Publish
   * takes the default (`defaultCommitMessage`).
   */
  readonly commitMessage: string;
  /** When Publish landed the commit message; after that it no longer changes. */
  readonly commitMessagePublishedAt: Date | undefined;
  /**
   * The Pipeline its work follows; its own Stages, once it has them, are kept by Pipelines.
   * Undefined until one is chosen: confirmed from the Planner's proposal, or chosen by the user
   * (spec §2.1). A Task is never Ready without one (`hasPipeline`).
   */
  readonly pipelineId: string | undefined;
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
   * Whether it has a planning Thread, its own or its Initiative's: set by its move to Planning, and
   * taken back when that Thread couldn't be opened. A changing Save on a Ready Task takes one that
   * has back to Planning, and one that hasn't (marked Ready from Backlog) to Backlog (spec §2.1).
   */
  readonly hasPlanningThread: boolean;
  /**
   * The Role whose person's Task limit it counts against from Start on: the Role of its Pipeline's
   * first Agent Stage, as the click-through counts; undefined before Start or without one.
   */
  readonly personRole: string | undefined;
  /**
   * The Stand-in Engines its run works on in place of the cascade's engines, as its last Start or
   * release of the queue chose them (stand-ins-at-start.ts), each with why; none while every Stage
   * runs on the cascade's. Every Start replaces it, so each tries the cascade's engines first.
   */
  readonly engineStandIns: readonly EngineStandIn[];
  /**
   * What holds it Paused apart from a Pause of the user's own; undefined for that and any other
   * state. The alarm's Tasks resume at the all clear, or the user's Hold makes them theirs (spec
   * §2.8); the Initiative's resume with Resume the Initiative, or become the user's as it is dropped.
   */
  readonly pausedBy: TaskHolder | undefined;
  /**
   * When a Task paused by the usage window resumes by itself: the window's reset. Kept while its
   * Initiative's Pause takes it over, so Resume the Initiative before the reset leaves it paused by
   * the usage window until then; undefined for every other Task.
   */
  readonly resumesAt: Date | undefined;
  /**
   * The engine whose usage window paused it, kept and cleared with `resumesAt`: a reading showing
   * that engine free again resumes it before the reset (`resumeTaskFreedByUsageWindow`). Undefined
   * for every other Task, and for one paused before the engine was kept, which waits for its reset.
   */
  readonly usageWindowEngineId: EngineId | undefined;
  /**
   * When the usage window last paused it, or moved its resume on, by The Office's clock, kept and
   * cleared with `usageWindowEngineId`: only a reading taken after it resumes the Task early.
   */
  readonly usageWindowPausedAt: Date | undefined;
  /**
   * What The Office made it for, in its Project: its Onboard Task, whose state is the Project's
   * onboarding, its "Set up the run environment" Task, an Initiative's Publishing Task there, or a
   * Conflict resolution Task; undefined for any other Task.
   */
  readonly madeFor: TaskMadeFor | undefined;
  /**
   * The Task whose pull request a Conflict resolution Task resolves the conflicts of; undefined for
   * any other Task.
   */
  readonly resolvesTaskId: string | undefined;
  /**
   * The Tasks that must be Done before it can start, in any Project, in the order they were added
   * (task-dependencies.ts); a Dropped one stays listed but no longer blocks.
   */
  readonly blockedBy: readonly string[];
  /** The Idea it was shaped from, if it was. */
  readonly originIdeaId: string | undefined;
  /**
   * The Initiative it is part of, if any: at most one; it joins and leaves one only before it
   * starts (initiative-membership.ts).
   */
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
  /** Who archived it, while it is; undefined too for one archived before that was kept. */
  readonly archivedBy: ArchivedBy | undefined;
  /** When it was last restored from the Archive, kept for archiving it again automatically. */
  readonly restoredAt: Date | undefined;
  /** Who last restored it, with `restoredAt`. */
  readonly restoredBy: Author | undefined;
  /**
   * When it last moved to Done or Dropped (`withStateChange`); undefined while it hasn't ended, and
   * for a Task whose end was never recorded. The board's Done column shows the latest first.
   */
  readonly endedAt: Date | undefined;
  /**
   * How its pull request ended, merged or closed, from Work › Pull requests or on the code host
   * (task-pull-request.ts): a mark beside its state, never one; undefined while it has none, or its
   * pull request is open again.
   */
  readonly pullRequestEnd: PullRequestEnd | undefined;
  /** Its branch's deletion (branch-deletion.ts); undefined while The Office deleted none. */
  readonly branchDeletion: BranchDeletionRecord | undefined;
  /** Feature, Bug or Chore (spec §2.1): its default Pipeline and its commit type follow it. */
  readonly kind: TaskKind;
  /** The Task whose work caused this Bug, in any Project; undefined for none. */
  readonly causedBy: string | undefined;
  /** The version the Bug was found in, free text; undefined for none. */
  readonly foundInVersion: string | undefined;
  /**
   * The Task it was found while working on, whatever its Kind: set as it is created, by a Bug Task
   * Decision or in a person's Thread on that Task, and never changed; undefined for none.
   */
  readonly foundWhileWorkingOn: string | undefined;
  /** Why it was Dropped, when a reason was given; undefined otherwise (drop-reason.ts). */
  readonly dropReason: DropReason | undefined;
  /**
   * Whether The Office created it by itself (a Task it made, or an issue it auto-imported):
   * `createdBy` still names an Author, which the previous release reads, and the read model names
   * The Office.
   */
  readonly createdByTheOffice: boolean;
  /**
   * The Task's engine override (spec 5.4.5): every session about it runs on this engine, with no
   * Stand-in Engines; null for none, when its Initiative's override applies, if any.
   */
  readonly engineOverride: EngineId | null;
}

/** The fields of a Task that hold its long texts, which most reads of many Tasks never need. */
export type TaskTextField =
  "description" | "plan" | "definitionOfDone" | "commitMessage" | "proposedPipeline";

/** A Task without its long texts, as a read of many Tasks gives it. */
export type TaskSummary = Omit<Task, TaskTextField>;

/** A Task's Move from one Project to another, kept for its record. */
export interface ProjectMove {
  readonly from: string;
  readonly to: string;
  readonly at: Date;
  readonly by: Author;
}

/** A Task whose Pipeline is chosen, as every Ready and started Task's is. */
export type TaskWithPipeline = Task & { readonly pipelineId: string };

export function hasPipeline<Of extends Pick<Task, "pipelineId">>(
  task: Of,
): task is Of & { readonly pipelineId: string } {
  return task.pipelineId !== undefined;
}

/** Why a Task with no Pipeline can't start; it can't be Ready either (task-states.ts). */
export const NO_PIPELINE_YET = "The Task has no Pipeline yet: choose a Pipeline first.";

/** A Pipeline the Planner chose from the Definition of Done, with why (spec §2.3). */
export interface ProposedPipeline {
  readonly pipelineId: string;
  readonly reason: string;
}

/** What creating a Task takes from whoever asks; The Office sets the rest. */
export type NewTask = Pick<Task, "title" | "projectId" | "priority"> &
  Partial<Pick<Task, "description" | "tags" | "kind">>;

/**
 * A new Task as given, trimmed, with its Tags normalized: no Description and no Tags when none
 * were given, and a Feature when no Kind was.
 */
export function trimmedNewTask(task: NewTask): Required<NewTask> {
  return {
    title: task.title.trim(),
    description: (task.description ?? "").trim(),
    projectId: task.projectId,
    priority: task.priority,
    tags: normalizedTags(task.tags ?? []),
    kind: task.kind ?? "feature",
  };
}

/** Why a new Task can't be created; that its Project exists is checked by the caller. */
export function newTaskProblems(task: NewTask): string[] {
  const problem = titleProblem(task.title, "Task");
  return [...(problem ? [problem] : []), ...tagsProblems(normalizedTags(task.tags ?? []))];
}
