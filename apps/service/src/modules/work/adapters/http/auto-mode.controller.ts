import { Controller, Get } from "@nestjs/common";
import type { AutoModeSetting } from "@the-office/contracts";
import { PlanningService } from "../../application/planning-service.js";

/** Make a plan's Auto mode switch: where it starts. Make a plan itself saves the choice. */
@Controller("settings/auto-mode")
export class AutoModeController {
  constructor(private readonly planning: PlanningService) {}

  @Get()
  async read(): Promise<AutoModeSetting> {
    return { autoMode: await this.planning.autoMode() };
  }
}
