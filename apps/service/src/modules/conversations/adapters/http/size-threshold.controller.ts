import { Controller, Get } from "@nestjs/common";
import type { SizeThreshold } from "@the-office/contracts";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";

/** Settings › Office limits: the Context policy's size threshold. */
@Controller("settings/size-threshold")
export class SizeThresholdController {
  constructor(private readonly settings: ContextPolicySettingsService) {}

  @Get()
  async read(): Promise<SizeThreshold> {
    return { sizeThreshold: await this.settings.sizeThreshold() };
  }
}
