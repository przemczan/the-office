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
