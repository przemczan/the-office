import { DomainEvent } from "../../../platform/events/domain-event.js";

/** The work going on now changed: an update or restart scheduled waits for what is left. */
export class BusyWorkChanged extends DomainEvent {
  constructor(readonly count: number) {
    super();
  }
}
