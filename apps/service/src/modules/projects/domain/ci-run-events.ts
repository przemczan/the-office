import { DomainEvent } from "../../../platform/events/domain-event.js";

/**
 * A listing of CI runs changed what Work › CI shows: a run added or moved on, a Project's runs gone
 * stale or fresh again, or its problem raised or cleared.
 */
export class CiRunsChecked extends DomainEvent {
  constructor(
    /** The Projects whose runs, staleness or problem changed. */
    readonly projectIds: readonly string[],
    checkedAt: Date,
  ) {
    super(checkedAt);
  }
}
