import { Injectable } from "@nestjs/common";
import { WorkSettings } from "../ports/work-settings.js";

/** The Office's limits on work as Work enforces them; Settings changes them (task 17). */
@Injectable()
export class OfficeLimits {
  constructor(private readonly settings: WorkSettings) {}

  /** How many Tasks may be started at once across the Office: the desks (spec §2.2). */
  officeWideLimit(): Promise<number> {
    return this.settings.officeWideLimit();
  }
}
