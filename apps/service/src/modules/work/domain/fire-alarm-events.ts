import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { FireAlarmWay } from "./fire-alarm.js";

/**
 * The user sounded the fire alarm (spec §2.8), or made the one on stricter, at `occurredAt`. ASAP:
 * every Stage, waiting Task and Consultation stops at its next safe point, a running Stage's turn
 * cut short once `hardStopAt` comes. A softer way sets no hard stop, and Consultations go on.
 */
export class AlarmSounded extends DomainEvent {
  constructor(
    readonly way: FireAlarmWay,
    /** Set exactly when `way` is ASAP. */
    readonly hardStopAt: Date | undefined,
    occurredAt: Date,
  ) {
    super(occurredAt);
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
