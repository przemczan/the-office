import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import {
  usageSettingsSchema,
  type UsageSettings as UsageSettingsRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeLimits } from "../../application/office-limits.js";
import {
  everyEngineCaps,
  namesEveryEngineId,
  type UsageSettings,
} from "../../domain/usage-settings.js";
import { toUsageSettingsResponse } from "./work-responses.js";

/** Settings › Office limits' Usage: the ticked measures and every engine id's caps. */
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
    if (!namesEveryEngineId(request.caps)) {
      throw new BadRequestException("caps: Every engine id has its caps, once.");
    }
    const usageSettings = usageSettingsOf(request);
    await this.limits.changeUsageSettings(usageSettings);
    return toUsageSettingsResponse(usageSettings);
  }
}

function usageSettingsOf({ measures, caps }: UsageSettingsRequest): UsageSettings {
  return {
    measures,
    caps: everyEngineCaps(
      caps.map(({ engineId, windows, dailyTokens, dailyDollars }) => ({
        engineId,
        windows: windows && {
          fiveHour: windows.fiveHour ?? undefined,
          sevenDay: windows.sevenDay ?? undefined,
        },
        dailyTokens: dailyTokens ?? undefined,
        dailyDollars: dailyDollars ?? undefined,
      })),
    ),
  };
}
