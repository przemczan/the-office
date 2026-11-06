import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Decision } from "./decision.js";
import type { Message, MessageDelivery } from "./message.js";
import type { Proposal } from "./proposal.js";
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

/** The user has seen more of a chat Thread, which may leave nobody answered there. */
export class ThreadSeen extends DomainEvent {
  constructor(
    readonly thread: Thread,
    seenAt: Date,
  ) {
    super(seenAt);
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

/**
 * Messages the user wrote into a running Stage Thread reached the person, never will, or wait again
 * as a Stage's next run carries them.
 */
export class DeliveryMarked extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly messageIds: readonly string[],
    readonly delivery: MessageDelivery,
    markedAt: Date,
  ) {
    super(markedAt);
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

/** The person's running turn counted more tokens on the Thread, before the turn's own count. */
export class TokensCounted extends DomainEvent {
  constructor(
    readonly thread: Thread,
    countedAt: Date,
  ) {
    super(countedAt);
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
 * A Decision waits anew: on the user again, as when the session its answer went to never started
 * or its Consultant can't answer it, or on the Consultant it was passed on to.
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

/** A person drafted a Proposal in the Thread, shown there as a card; it waits on the user. */
export class ProposalDrafted extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly proposal: Proposal,
  ) {
    super(proposal.draftedAt);
  }
}

/** The user applied a Proposal: the module that owns what it changes carried it out. */
export class ProposalApplied extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly proposal: Proposal,
    appliedAt: Date,
  ) {
    super(appliedAt);
  }
}

/** The user declined a Proposal: nothing changed. */
export class ProposalDeclined extends DomainEvent {
  constructor(
    readonly thread: Thread,
    readonly proposal: Proposal,
    declinedAt: Date,
  ) {
    super(declinedAt);
  }
}

/** Settings saved a new size threshold; the next continuation of every Thread reads it. */
export class SizeThresholdChanged extends DomainEvent {
  constructor(readonly sizeThreshold: number) {
    super();
  }
}

/** A new version of the Office instructions was saved; sessions started from now on get it. */
export class OfficeInstructionsChanged extends DomainEvent {
  constructor(readonly version: number) {
    super();
  }
}
