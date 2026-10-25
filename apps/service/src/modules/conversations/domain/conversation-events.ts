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

/** A turn of the person's ended: the Thread's tokens, its session's context and its state changed. */
export class TurnEnded extends DomainEvent {
  constructor(
    readonly thread: Thread,
    endedAt: Date,
  ) {
    super(endedAt);
  }
}

/** The user chose "Start fresh" or "Continue anyway" for the next message, or went back to the policy. */
export class ContextOverrideChosen extends DomainEvent {
  constructor(
    readonly thread: Thread,
    chosenAt: Date,
  ) {
    super(chosenAt);
  }
}
