import type { DropReason } from "./drop-reason.js";
import type { DecisionWaitingOnTheUser } from "./record-words.js";
import type { StateChange } from "./state-change.js";
import type { Task, TaskMadeFor } from "./task.js";
import { STARTED_STATES } from "./task-states.js";

/**
 * The Tasks The Office makes and starts at once, kept off the board (spec §2.1, "Off-board
 * Tasks"): a Project's Onboard Task and its "Set up the run environment" Task. Still Tasks, with
 * their worktree, Stages, Decisions and Publish; never Ready for a Start of the user's, but one made
 * before they started at once still waits for it.
 */
export const OFF_BOARD_TASK_KINDS = ["onboard", "run-environment-setup"] as const;
export type OffBoardTaskKind = (typeof OFF_BOARD_TASK_KINDS)[number];

export function isOffBoardTask(task: { readonly madeFor: TaskMadeFor | undefined }): boolean {
  return (OFF_BOARD_TASK_KINDS as readonly (TaskMadeFor | undefined)[]).includes(task.madeFor);
}

/** Whether the Task is an Off-board Task of that kind neither Done nor Dropped. */
export function isOpenOffBoardTask(task: Task, kind: OffBoardTaskKind): boolean {
  return task.madeFor === kind && task.state !== "done" && task.state !== "dropped";
}

/**
 * Where an Off-board Task stands: `failed` is a Stage out of tries with its Decision open, `withCto`
 * while the holder of "Asked first when a Stage runs out of tries" still has it; `ready` is one made
 * before Off-board Tasks started at once, which waits for Start.
 */
export type OffBoardTaskStatus =
  | {
      readonly state: "queued";
      /** Its place in the queue, from 1. */
      readonly place: number;
      readonly shortReasons: readonly string[];
      readonly queuedAt: Date;
    }
  | { readonly state: "running" }
  | {
      readonly state: "waiting-on-you";
      readonly decisionId: string | undefined;
      readonly question: string | undefined;
    }
  | { readonly state: "paused" }
  | {
      readonly state: "failed";
      readonly stageName: string;
      readonly error: string | undefined;
      readonly decisionId: string;
      readonly withCto: boolean;
    }
  | { readonly state: "ready" }
  | { readonly state: "done"; readonly endedAt: Date | undefined }
  | {
      readonly state: "dropped";
      readonly endedAt: Date | undefined;
      readonly dropReason: string | undefined;
    };

export interface OffBoardTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly title: string;
  readonly kind: OffBoardTaskKind;
  readonly status: OffBoardTaskStatus;
  /** Its Stage names in order: the Task's own once made, else its Pipeline's. */
  readonly stages: readonly string[];
  /** The Stage of its latest run; undefined before it started. */
  readonly currentStage: string | undefined;
  /** Who works its current Stage, while it is started; undefined otherwise. */
  readonly person: { readonly roleKey: string; readonly name: string } | undefined;
  /** The latest Stage run's Thread, while it is started; undefined otherwise. */
  readonly threadId: string | undefined;
  /** When it entered its state. */
  readonly since: Date;
  /** Every Stage Thread's tokens so far: input, output and cache writes. */
  readonly tokens: number;
}

/** A Project's latest Off-board Task of each kind, and its earlier Onboard Tasks, newest first. */
export interface ProjectOffBoardTasks {
  readonly onboard: OffBoardTask | undefined;
  readonly onboardHistory: readonly OffBoardTask[];
  readonly runEnvironmentSetUp: OffBoardTask | undefined;
}

/**
 * What starting an Off-board Task did: started or queued (`started`, its status saying which), the
 * one of its kind already open (`in-flight`), or refused with every reason, which made nothing.
 */
export type OffBoardTaskStart =
  | { readonly outcome: "started"; readonly offBoardTask: OffBoardTask }
  | { readonly outcome: "in-flight"; readonly offBoardTask: OffBoardTask }
  | { readonly outcome: "refused"; readonly reasons: readonly string[] };

/** One run of the Task's Stages, as Pipelines outlines it. */
export interface OffBoardStageRun {
  readonly stageName: string;
  readonly roleKey: string | undefined;
  readonly threadId: string | undefined;
  /** The failure's error of a failed run; undefined for any other. */
  readonly error: string | undefined;
  /** Its Decision on running out of tries while it is open; undefined otherwise. */
  readonly openOutOfTriesDecisionId: string | undefined;
}

/** What an Off-board Task is read from besides the Task. */
export interface OffBoardTaskParts {
  /** Its entry in the queue, with its place from 1; undefined while it isn't queued. */
  readonly queued:
    | {
        readonly place: number;
        readonly shortReasons: readonly string[];
        readonly queuedAt: Date;
      }
    | undefined;
  /** The Task's own Stage names once made; undefined before. */
  readonly ownStages: readonly string[] | undefined;
  /** Its Pipeline's Stage names; none when there is no such Pipeline. */
  readonly pipelineStages: readonly string[];
  /** Its Stage runs, in the order they ran. */
  readonly runs: readonly OffBoardStageRun[];
  /** The Decisions on it waiting on the user, the first asked first. */
  readonly waitingOnTheUser: readonly DecisionWaitingOnTheUser[];
  /** The kept state changes, oldest first. */
  readonly stateChanges: readonly StateChange[];
  /** The name of the person of each Role, by its key; undefined for one nobody fills. */
  readonly personName: (roleKey: string) => string | undefined;
  readonly tokens: number;
}

/** Undefined for a Task that isn't an Off-board Task. */
export function offBoardTaskOf(task: Task, parts: OffBoardTaskParts): OffBoardTask | undefined {
  const kind = offBoardKindOf(task);
  if (kind === undefined) return undefined;
  const status = statusOf(task, parts);
  const latest = parts.runs.at(-1);
  const started = STARTED_STATES.includes(task.state);
  const roleKey = started ? latest?.roleKey : undefined;
  const name = roleKey === undefined ? undefined : parts.personName(roleKey);
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    kind,
    status,
    stages: parts.ownStages ?? parts.pipelineStages,
    currentStage: latest?.stageName,
    person: roleKey === undefined || name === undefined ? undefined : { roleKey, name },
    threadId: started ? latest?.threadId : undefined,
    since: sinceOf(task, status, parts.stateChanges),
    tokens: parts.tokens,
  };
}

function offBoardKindOf(task: Task): OffBoardTaskKind | undefined {
  return OFF_BOARD_TASK_KINDS.find((kind) => kind === task.madeFor);
}

function statusOf(task: Task, parts: OffBoardTaskParts): OffBoardTaskStatus {
  switch (task.state) {
    case "done":
      return { state: "done", endedAt: task.endedAt };
    case "dropped":
      return {
        state: "dropped",
        endedAt: task.endedAt,
        dropReason: task.dropReason && dropReasonWords(task.dropReason),
      };
    case "in-progress":
      return { state: "running" };
    case "paused":
      return { state: "paused" };
    case "waiting-on-you":
      return waitingStatusOf(parts);
    default:
      return parts.queued ? { state: "queued", ...parts.queued } : { state: "ready" };
  }
}

/** Failed while the latest run out of tries has its Decision open; else what it waits on. */
function waitingStatusOf({ runs, waitingOnTheUser }: OffBoardTaskParts): OffBoardTaskStatus {
  const outOfTries = runs.findLast(({ openOutOfTriesDecisionId }) => openOutOfTriesDecisionId);
  const decisionId = outOfTries?.openOutOfTriesDecisionId;
  if (outOfTries && decisionId !== undefined) {
    return {
      state: "failed",
      stageName: outOfTries.stageName,
      error: outOfTries.error,
      decisionId,
      // Put to the Consultant first, it waits on the user only once handed on.
      withCto: !waitingOnTheUser.some(({ id }) => id === decisionId),
    };
  }
  const first = waitingOnTheUser[0];
  return {
    state: "waiting-on-you",
    decisionId: first?.id,
    question: first?.questions[0]?.question,
  };
}

function sinceOf(
  task: Task,
  status: OffBoardTaskStatus,
  stateChanges: readonly StateChange[],
): Date {
  if (status.state === "queued") return status.queuedAt;
  return stateChanges.at(-1)?.at ?? task.endedAt ?? task.createdAt;
}

/** Why it was Dropped, in the drop dialog's words. */
export function dropReasonWords(reason: DropReason): string {
  switch (reason.kind) {
    case "wont-fix":
      return "Won't fix";
    case "duplicate":
      return "Duplicate";
    case "cant-reproduce":
      return "Can't reproduce";
    case "other":
      return reason.text;
  }
}

/**
 * The Project's latest of each kind and its earlier Onboard Tasks, newest first, from its
 * Off-board Tasks given newest made first (`newestMadeFirst`).
 */
export function projectOffBoardTasksOf(newestFirst: readonly OffBoardTask[]): ProjectOffBoardTasks {
  const ofKind = (kind: OffBoardTaskKind) => newestFirst.filter((each) => each.kind === kind);
  const [onboard, ...onboardHistory] = ofKind("onboard");
  return {
    onboard,
    onboardHistory,
    runEnvironmentSetUp: ofKind("run-environment-setup")[0],
  };
}

/** The Tasks newest first, by when they were made. */
export function newestMadeFirst<T extends Pick<Task, "createdAt" | "id">>(
  tasks: readonly T[],
): T[] {
  return tasks.toSorted(
    (one, other) =>
      other.createdAt.getTime() - one.createdAt.getTime() || other.id.localeCompare(one.id),
  );
}
