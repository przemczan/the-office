import { Controller, Get } from "@nestjs/common";
import type { ArchivePeriod } from "@the-office/contracts";
import { OfficeLimits } from "../../application/office-limits.js";

/**
 * Settings › Office limits: the Archive period, in days, read here; its change is an Office action
 * (`SET_ARCHIVE_PERIOD_ACTION`, routed by `WorkSettingsOfficeActionsController`).
 */
@Controller("settings/archive-period")
export class ArchivePeriodController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<ArchivePeriod> {
    return { archivePeriod: await this.limits.archivePeriod() };
  }
}
