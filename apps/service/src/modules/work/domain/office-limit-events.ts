import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { UsageSettings } from "./usage-settings.js";

/** Settings saved a new Office-wide limit; the next Start reads it. */
export class OfficeWideLimitChanged extends DomainEvent {
  constructor(readonly officeWideLimit: number) {
    super();
  }
}

/** Settings saved a new Archive period; the next daily run archives by it. */
export class ArchivePeriodChanged extends DomainEvent {
  constructor(readonly archivePeriod: number) {
    super();
  }
}

/** Settings saved the ticked measures and the caps; the next Start and release weigh them. */
export class UsageSettingsChanged extends DomainEvent {
  constructor(readonly usageSettings: UsageSettings) {
    super();
  }
}
