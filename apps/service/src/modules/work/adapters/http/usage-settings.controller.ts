import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import {
  usageSettingsSchema,
  type UsageSettings as UsageSettingsRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeLimits } from "../../application/office-limits.js";
import type { UsageSettings } from "../../domain/usage-settings.js";
import { toUsageSettingsResponse } from "./work-responses.js";

/** Settings › Office limits' Usage: the ticked measures and every engine's caps. */
@Controller("settings/usage")
export class UsageSettingsController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<UsageSettingsRequest> {
    return toUsageSettingsResponse(await this.limits.usageSettings());
  }

  @Put()
  async change(
    @Body(new ContractPipe(usageSettingsSchema)) request: UsageSettingsRequest,
  ): Promise<UsageSettingsRequest> {
    const settings = usageSettingsOf(request);
    const problem = await this.limits.capsProblem(settings.caps);
    if (problem !== undefined) throw new BadRequestException(`caps: ${problem}`);
    return toUsageSettingsResponse(await this.limits.changeUsageSettings(settings));
  }
}

function usageSettingsOf({ measures, caps }: UsageSettingsRequest): UsageSettings {
  return {
    measures,
    caps: caps.map(({ engineId, windows, dailyTokens, dailyDollars }) => ({
      engineId,
      windows: windows && {
        fiveHour: windows.fiveHour ?? undefined,
        sevenDay: windows.sevenDay ?? undefined,
      },
      dailyTokens: dailyTokens ?? undefined,
      dailyDollars: dailyDollars ?? undefined,
    })),
  };
}
