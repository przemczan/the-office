import { Controller, Get } from "@nestjs/common";
import type { UsageSettings as UsageSettingsResponse } from "@the-office/contracts";
import { OfficeLimits } from "../../application/office-limits.js";
import { toUsageSettingsResponse } from "./work-responses.js";

/**
 * Settings › Office limits' Usage: the ticked measures and every engine's caps, read here; its
 * change is an Office action (`SET_USAGE_SETTINGS_ACTION`, routed by
 * `WorkSettingsOfficeActionsController`).
 */
@Controller("settings/usage")
export class UsageSettingsController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<UsageSettingsResponse> {
    return toUsageSettingsResponse(await this.limits.usageSettings());
  }
}
