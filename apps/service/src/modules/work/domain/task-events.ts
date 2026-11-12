import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Priority, Task, TaskHolder, TaskState } from "./task.js";

export class TaskCreated extends DomainEvent {
  constructor(readonly task: Task) {
    super(task.createdAt);
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

/** The Task's Description was rewritten. */
export class TaskDescriptionChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
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
 * Who paused a Task: the user; the fire alarm (spec §2.8), which the all clear resumes; or its
 * Initiative's Pause, which Resume the Initiative resumes.
 */
export type PausedBy = "user" | TaskHolder;

/**
 * The Task is held Paused: its running Stage is held once the Agent's turn ends (spec §2.4), or, by
 * the fire alarm, at its next safe point (spec §2.8). `from` is Paused when the alarm took over a
 * Resume the user asked for while it was on, or the Initiative's Pause took over the alarm's hold.
 */
export class TaskPaused extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
    readonly by: PausedBy = "user",
  ) {
    super();
  }
}

/**
 * The user stopped the Task: the Stage running now is interrupted, and the Task held (spec §2.4).
 * `from` is Paused when the user paused it first.
 */
export class TaskStopped extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
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

/**
 * The user dropped the Initiative whose Pause held the Task: it stays Paused, now as their own
 * Pause, as Hold leaves a Task at the all clear.
 */
export class TaskHeldAtInitiativeDrop extends DomainEvent {
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

/** Ready → In progress: the user started the Task, following its Pipeline. */
export class TaskStarted extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
  ) {
    super();
  }
}
