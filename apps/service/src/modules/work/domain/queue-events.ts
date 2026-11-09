import { DomainEvent } from "../../../platform/events/domain-event.js";

/** Only waits kept Start from running the Task now, so it joined the queue at its place. */
export class TaskQueued extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly reasons: readonly string[],
  ) {
    super();
  }
}

/**
 * Why a Task left the queue: it started by itself, the user took it out, it left Ready (or was
 * dropped), or its turn met a reason that refuses Start, named in `refusals`.
 */
export type LeavingQueue = "started" | "taken-out" | "left-ready" | "refused";

export class TaskLeftQueue extends DomainEvent {
  constructor(
    readonly taskId: string,
    readonly why: LeavingQueue,
    readonly refusals: readonly string[] = [],
  ) {
    super();
  }
}

/** A release found the queued Task held by other reasons than the ones shown. */
export class TaskQueueReasonsChanged extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}

/** The user moved the Task up in the queue: one place, or to the top. */
export class TaskMovedUpInQueue extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}
