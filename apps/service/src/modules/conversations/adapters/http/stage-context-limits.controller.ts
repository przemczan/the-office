import { Controller, Get } from "@nestjs/common";
import type { StageContextLimitsSetting } from "@the-office/contracts";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";

/** Settings › Office limits: the Office defaults of every Agent Stage's context limits. */
@Controller("settings/stage-context-limits")
export class StageContextLimitsController {
  constructor(private readonly settings: ContextPolicySettingsService) {}

  @Get()
  async read(): Promise<StageContextLimitsSetting> {
    return { stageContextLimits: await this.settings.stageContextLimits() };
  }
}
