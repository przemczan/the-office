import { Controller, Get } from "@nestjs/common";
import type { ActionSettings } from "@the-office/contracts";
import { ActionLimits } from "../../application/action-limits.js";

/**
 * Settings › Office limits' Actions card: Actions at once, read here; its change is an Office
 * action (`SET_ACTION_SETTINGS_ACTION`, routed by `ActionSettingsOfficeActionsController`).
 */
@Controller("settings/actions")
export class ActionSettingsController {
  constructor(private readonly limits: ActionLimits) {}

  @Get()
  read(): Promise<ActionSettings> {
    return this.limits.read();
  }
}
