import { DomainEvent } from "../../../platform/events/domain-event.js";

/** Start couldn't run the Task now only for a limit, so it joined the queue at its place. */
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

/** The user moved the Task up one place in the queue, past the one ahead of it. */
export class TaskMovedUpInQueue extends DomainEvent {
  constructor(readonly taskId: string) {
    super();
  }
}
