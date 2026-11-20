import { Body, Controller, Get, Put } from "@nestjs/common";
import {
  stageContextLimitsSettingSchema,
  type StageContextLimitsSetting,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";

/** Settings › Office limits: the Office defaults of every Agent Stage's context limits. */
@Controller("settings/stage-context-limits")
export class StageContextLimitsController {
  constructor(private readonly settings: ContextPolicySettingsService) {}

  @Get()
  async read(): Promise<StageContextLimitsSetting> {
    return { stageContextLimits: await this.settings.stageContextLimits() };
  }

  @Put()
  async change(
    @Body(new ContractPipe(stageContextLimitsSettingSchema))
    { stageContextLimits }: StageContextLimitsSetting,
  ): Promise<StageContextLimitsSetting> {
    await this.settings.changeStageContextLimits(stageContextLimits);
    return { stageContextLimits };
  }
}
