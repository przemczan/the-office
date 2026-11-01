import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { UsageSettings } from "./usage-settings.js";

/** Settings saved a new Office-wide limit; the next Start reads it. */
export class OfficeWideLimitChanged extends DomainEvent {
  constructor(readonly officeWideLimit: number) {
    super();
  }
}

/** Settings saved the ticked measures and the caps; the next Start and release weigh them. */
export class UsageSettingsChanged extends DomainEvent {
  constructor(readonly usageSettings: UsageSettings) {
    super();
  }
}
