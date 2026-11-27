import { Controller, Get } from "@nestjs/common";
import type { OfficeWideLimit } from "@the-office/contracts";
import { OfficeLimits } from "../../application/office-limits.js";

/**
 * Settings › Office limits: the desks, the Office-wide limit on started Tasks, read here; its
 * change is an Office action (`SET_OFFICE_WIDE_LIMIT_ACTION`, routed by
 * `WorkSettingsOfficeActionsController`).
 */
@Controller("settings/office-wide-limit")
export class OfficeLimitsController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<OfficeWideLimit> {
    return { officeWideLimit: await this.limits.officeWideLimit() };
  }
}
