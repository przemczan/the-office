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
