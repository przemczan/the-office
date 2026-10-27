import { DomainEvent } from "../../../platform/events/domain-event.js";

/** Settings saved a new Office-wide limit; the next Start reads it. */
export class OfficeWideLimitChanged extends DomainEvent {
  constructor(readonly officeWideLimit: number) {
    super();
  }
}
