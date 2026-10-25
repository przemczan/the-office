import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Message } from "./message.js";
import type { Thread } from "./thread.js";

export class ThreadStarted extends DomainEvent {
  constructor(readonly thread: Thread) {
    super(thread.startedAt);
  }
}

export class ThreadRenamed extends DomainEvent {
  constructor(
    readonly thread: Thread,
    renamedAt: Date,
  ) {
    super(renamedAt);
  }
}

/** Messages joined the Thread's log; the first of the user's also titles an untitled Thread. */
export class MessagesLogged extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly messages: readonly Message[],
    loggedAt: Date,
  ) {
    super(loggedAt);
  }
}
