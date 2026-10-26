import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Decision } from "./decision.js";
import type { Message, MessageDelivery } from "./message.js";
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

/** Messages the user wrote into a running Stage Thread reached the person, or never will. */
export class DeliveryMarked extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly messageIds: readonly string[],
    readonly delivery: Exclude<MessageDelivery, "waiting">,
    markedAt: Date,
  ) {
    super(markedAt);
  }
}

/** A turn of the person's ended:the Thread's tokens, its session's context and its state changed. */
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

/** An Agent opened a Decision in the Thread it works in: it waits on the user. */
export class DecisionOpened extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly decision: Decision,
  ) {
    super(decision.askedAt);
  }
}

/** The user answered a Decision, and the asking person takes the answer as their next message. */
export class DecisionAnswered extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly decision: Decision,
    answeredAt: Date,
  ) {
    super(answeredAt);
  }
}

/**
 * The session a Decision's answer went to never started: the Decision waits on the user again,
 * and the Thread logged why.
 */
export class DecisionReopened extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly decision: Decision,
    reopenedAt: Date,
  ) {
    super(reopenedAt);
  }
}
