import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeWideLimitChanged } from "../domain/office-limit-events.js";
import { WorkSettings } from "../ports/work-settings.js";

/** The Office's limits on work as Work enforces them; Settings › Office limits changes them. */
@Injectable()
export class OfficeLimits {
  constructor(
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
  ) {}

  /** How many Tasks may be started at once across the Office: the desks (spec §2.2). */
  officeWideLimit(): Promise<number> {
    return this.settings.officeWideLimit();
  }

  /**
   * Applies to the next Start. A limit below the Tasks already started stops none of them: nothing
   * new starts until enough end.
   */
  async changeOfficeWideLimit(officeWideLimit: number): Promise<void> {
    await this.settings.changeOfficeWideLimit(officeWideLimit);
    await this.events.publish(new OfficeWideLimitChanged(officeWideLimit));
  }
}
