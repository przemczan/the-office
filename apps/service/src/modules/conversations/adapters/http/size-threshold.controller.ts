import { Body, Controller, Get, Put } from "@nestjs/common";
import { sizeThresholdSchema, type SizeThreshold } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";

/** Settings › Office limits: the Context policy's size threshold. */
@Controller("settings/size-threshold")
export class SizeThresholdController {
  constructor(private readonly settings: ContextPolicySettingsService) {}

  @Get()
  async read(): Promise<SizeThreshold> {
    return { sizeThreshold: await this.settings.sizeThreshold() };
  }

  @Put()
  async change(
    @Body(new ContractPipe(sizeThresholdSchema)) { sizeThreshold }: SizeThreshold,
  ): Promise<SizeThreshold> {
    await this.settings.changeSizeThreshold(sizeThreshold);
    return { sizeThreshold };
  }
}
