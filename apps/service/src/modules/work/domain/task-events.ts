import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineId } from "../../engine/index.js";
import type { UserRef } from "./author.js";
import type { Priority, Task, TaskHolder, TaskKind, TaskState } from "./task.js";

export class TaskCreated extends DomainEvent {
  constructor(readonly task: Task) {
    super(task.createdAt);
  }
}

/**
 * A Task just made was taken away again, as the Start it was made for was refused: its row, its
 * worktree and its creation are gone, so whatever showed it after `TaskCreated` drops it.
 */
export class TaskDiscarded extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly projectId: string,
  ) {
    super();
  }
}

export class TaskStateChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
    readonly to: TaskState,
  ) {
    super();
  }
}

/** The Task left the board for the Archive; its state is as it was, so nothing else moves. */
export class TaskArchived extends DomainEvent {
  constructor(
    readonly taskId: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** The Task came back from the Archive to the board, in the state it had. */
export class TaskRestored extends DomainEvent {
  constructor(
    readonly taskId: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

export class TaskPriorityChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly priority: Priority,
  ) {
    super();
  }
}

/** The Task's title was rewritten. */
export class TaskTitleChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The Task's Kind changed: Feature, Bug or Chore. */
export class TaskKindChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly kind: TaskKind,
  ) {
    super();
  }
}

/** The Task's engine override was set, or cleared with null (spec 5.4.5). */
export class TaskEngineOverrideSet extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly engineOverride: EngineId | null,
  ) {
    super();
  }
}

/**
 * The engine override of the Initiative the Task is in changed for it, which applies while it has
 * none of its own: its Initiative's override was set, or it joined or left an Initiative with another.
 */
export class TaskInitiativeEngineOverrideChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly initiativeEngineOverride: EngineId | null,
  ) {
    super();
  }
}

/** The Task's Caused by or Found in version changed. */
export class TaskBugDetailsChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The Task's Description was rewritten. */
export class TaskDescriptionChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The Task's commit message was rewritten, or Publish landed it. */
export class TaskCommitMessageChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The Task's branch was deleted, by hand or by Delete branches once merged (branch-deletion.ts). */
export class TaskBranchDeleted extends DomainEvent {
  constructor(
    readonly taskId: string,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** The Task's pull request was merged or closed, and the Task records how (task-pull-request.ts). */
export class TaskPullRequestEnded extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly outcome: "merged" | "closed",
    readonly number: number,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** The Task's pull request shows up open again, so the end it recorded is cleared. */
export class TaskPullRequestReopened extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly number: number,
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}

/** The Task's Tags as they now are. */
export class TaskTagsChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly tags: readonly string[],
  ) {
    super();
  }
}

/** Moved on the board, taking the priority of where it was dropped. */
export class TaskReordered extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly priority: Priority,
    readonly order: string,
  ) {
    super();
  }
}

/**
 * The Planner wrote the Plan; it shows as proposed until the user confirms it. `leftReady` is the move back to Planning it made on a Ready Task,
 * published after this event, as `TaskPlanSaved`'s.
 */
export class TaskPlanProposed extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/**
 * The user changed the Plan, which leaves it unconfirmed. `leftReady` is the move it made on a
 * Ready Task, published after this event: one save, so a failure can't leave the Task changed and Ready.
 */
export class TaskPlanSaved extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/**
 * The Task moved to another Project, with no Pipeline until one is chosen there; a Ready Task left
 * Ready in the same save, as `leftReady` says.
 */
export class TaskMovedToProject extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly fromProjectId: string,
    readonly toProjectId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/** The user confirmed the Plan as it reads. */
export class TaskPlanConfirmed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** As `TaskPlanProposed`, for the Definition of Done. */
export class TaskDefinitionOfDoneProposed extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/** As `TaskPlanSaved`, for the Definition of Done. */
export class TaskDefinitionOfDoneSaved extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

export class TaskDefinitionOfDoneConfirmed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** As `TaskPlanProposed`, for a Pipeline. */
export class TaskPipelineProposed extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
    readonly leftReady: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/** The user set the Task's Pipeline: the one proposed, or another. */
export class TaskPipelineConfirmed extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}

/** The Planner marked the Task planned (mark_planned), in whichever Thread it is planned in. */
export class TaskMarkedPlanned extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/**
 * Auto mode accepted the Task the Planner marked planned, in one save: it confirmed what was
 * unconfirmed and marked it Ready. Never published itself: its `confirmations`, then its
 * `stateChanged`, are, so everything reacts as to the user's own clicks.
 */
export class TaskAcceptedInAutoMode extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly confirmations: readonly (
      TaskPlanConfirmed | TaskDefinitionOfDoneConfirmed | TaskPipelineConfirmed
    )[],
    readonly stateChanged: TaskStateChanged,
  ) {
    super();
  }
}

/**
 * The user marked the Task Ready confirming its Plan and Definition of Done as they stand, even
 * empty, in one save (spec §2.1). Never published itself: its `confirmations`, then its
 * `stateChanged`, are, as for the user's own Confirms and Mark Ready.
 */
export class TaskMarkedReadyAsItStands extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly confirmations: readonly (TaskPlanConfirmed | TaskDefinitionOfDoneConfirmed)[],
    readonly stateChanged: TaskStateChanged,
  ) {
    super();
  }
}

/**
 * The Planner rewrote a part of an already planned Task from its Initiative's planning Thread
 * (spec §2.1): `written` is the part's own event, and `moves` the moves the same save made, such
 * as a Ready Task's to Backlog and on to Planning, published after it.
 */
export class TaskRewrittenInInitiative extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly written: DomainEvent,
    readonly moves: readonly TaskStateChanged[],
  ) {
    super();
  }
}

/**
 * Who paused a Task: the user; the fire alarm (spec §2.8), which the all clear resumes; its
 * Initiative's Pause, which Resume the Initiative resumes; or its engine's usage window, used up
 * until its reset, which resumes it.
 */
export type PausedBy = "user" | TaskHolder;

/**
 * A Stage's turn the engine refused because a usage window of its account is used up (spec §2.1,
 * "A pause by the usage window"): the engine, its name at the time for the words, the window in
 * the engine module's words, and when the window resets, when the Task resumes.
 */
export interface UsageWindowRefusal {
  readonly engineId: string;
  readonly engineName: string;
  readonly window: string;
  readonly resetsAt: Date;
  /**
   * Set when the Stage waits for the user's choice of a Stand-in Engine (spec 5.4), which The
   * Office's own Decision in Needs you asks, so no separate Task paused Notification is raised.
   */
  readonly awaitsStandInChoice?: true;
}

/**
 * The Task is held Paused: its running Stage is held once the Agent's turn ends (spec §2.4), or, by
 * the fire alarm, at its next safe point (spec §2.8); by the usage window, its Stage's run already
 * ended held by the Stage runner, with the refusal it resumes after. `from` is Paused when the
 * alarm took over a Resume the user asked for while it was on, the Initiative's Pause took over the
 * alarm's or the usage window's hold, or a refusal again moved the usage window's resume on.
 * `user` is the user who asked for the Pause or the Initiative's Pause; undefined for any other.
 */
export class TaskPaused extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
    readonly by: PausedBy = "user",
    readonly usageWindow?: UsageWindowRefusal,
    readonly user?: UserRef,
  ) {
    super();
  }
}

/**
 * The user stopped the Task: the Stage running now is interrupted, and the Task held (spec §2.4).
 * `from` is Paused when the user paused it first; `user` is the user who stopped it.
 */
export class TaskStopped extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
    readonly user?: UserRef,
  ) {
    super();
  }
}

/**
 * The user held a Task the fire alarm paused as they gave the all clear (spec §2.8): it stays
 * Paused, now as their own Pause, and nothing of it runs until they resume it.
 */
export class TaskHeldAtAllClear extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** Paused → In progress: the user resumed the Task, whose Pipeline goes on where it was held. */
export class TaskResumed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/**
 * A Stage of the Task went on on the Stand-in Engine `standInId` in place of the cascade's engine
 * `engineId`, whose usage window was used up (spec 5.4): the run's later Stages open on it too.
 */
export class TaskWentOnOnStandIn extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly engineId: string,
    readonly standInId: string,
  ) {
    super();
  }
}

/** The Task must now wait for `blockerId` to be Done before it can start. */
export class TaskDependencyAdded extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly blockerId: string,
  ) {
    super();
  }
}

/** The Task no longer waits for `blockerId`. */
export class TaskDependencyRemoved extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly blockerId: string,
  ) {
    super();
  }
}

/**
 * An existing Task joined the Initiative; a Backlog Task joining one being shaped moved to Shaping
 * in the same save, as `stateChanged` says.
 */
export class TaskAddedToInitiative extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly initiativeId: string,
    readonly stateChanged: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/**
 * The Task left the Initiative; one in Shaping, or planned in the Initiative's planning Thread,
 * moved to Backlog in the same save, as `stateChanged` says.
 */
export class TaskTakenOutOfInitiative extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly initiativeId: string,
    readonly stateChanged: TaskStateChanged | undefined,
  ) {
    super();
  }
}

/** Ready → In progress: the user started the Task, following its Pipeline. */
export class TaskStarted extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}

/**
 * Paused → Ready: the user started the Task over (spec 2.4.5, "Start over"), its earlier Stage runs
 * kept as history only. With `resetBranch`, its branch was reset to `resetTo`, its old head kept
 * under `keptRef`; both undefined when it wasn't. `stateChanged`, the move, is published before it.
 */
export class TaskStartedOver extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly resetBranch: boolean,
    readonly resetTo: string | undefined,
    readonly keptRef: string | undefined,
    readonly user: UserRef,
    readonly stateChanged: TaskStateChanged,
  ) {
    super();
  }
}

/**
 * Dropped → Backlog or Ready (Shaping for a Task of an Initiative still being shaped): the user
 * reopened the Task (spec 2.1.3, "Reopen…"), as `to` asked. `restored` is the Restore an archived
 * one took first, and `stateChanged` the move, both published before it. `startedOver` is whether
 * a Task that had started was started over with it, its branch reset to `resetTo` with
 * `resetBranch`, the old head kept under `keptRef`.
 */
export class TaskReopened extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly to: "backlog" | "ready",
    readonly resetBranch: boolean,
    readonly startedOver: boolean,
    readonly resetTo: string | undefined,
    readonly keptRef: string | undefined,
    readonly user: UserRef,
    readonly stateChanged: TaskStateChanged,
    readonly restored: TaskRestored | undefined,
  ) {
    super();
  }
}
