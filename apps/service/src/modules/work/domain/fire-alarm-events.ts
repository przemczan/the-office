import { DomainEvent } from "../../../platform/events/domain-event.js";

/**
 * The user sounded the fire alarm (spec §2.8): every Stage, waiting Task and Consultation stops at
 * its next safe point, a running Stage's turn cut short once `hardStopAt` comes.
 */
export class AlarmSounded extends DomainEvent {
  constructor(
    readonly since: Date,
    readonly hardStopAt: Date,
  ) {
    super(since);
  }
}

/**
 * The user gave the all clear (spec §2.8): the alarm is off, and the Tasks it paused were resumed,
 * held as the user's own Pause or dropped, as they chose on Now. What waits in the queue may start,
 * and the Consultations it stopped are asked again.
 */
export class AllClearGiven extends DomainEvent {
  constructor(
    readonly resumed: readonly string[],
    readonly held: readonly string[],
    readonly dropped: readonly string[],
    occurredAt: Date,
  ) {
    super(occurredAt);
  }
}
