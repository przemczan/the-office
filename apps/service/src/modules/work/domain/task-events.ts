import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Priority, Task, TaskState } from "./task.js";

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

export class TaskPriorityChanged extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly priority: Priority,
  ) {
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

/** The Planner wrote the Plan; it shows as proposed until the user confirms it. */
export class TaskPlanProposed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The user confirmed the Plan, as proposed or as they edited it. */
export class TaskPlanConfirmed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

export class TaskDefinitionOfDoneProposed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

export class TaskDefinitionOfDoneConfirmed extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

export class TaskPipelineProposed extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly pipelineId: string,
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

/** The user paused the Task: its running Stage is held once the Agent's turn ends (spec §2.4). */
export class TaskPaused extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly from: TaskState,
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
