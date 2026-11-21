import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import { testInstanceSettingsSchema, type TestInstanceSettings } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { TestInstanceLimits } from "../../application/test-instance-limits.js";

/**
 * Settings › Office limits' Test instances card: the contract keeps the bounds, the service keeps
 * The Office's own port out of the Proxy ports; either refusal answers 400 naming the field.
 */
@Controller("settings/test-instances")
export class TestInstanceSettingsController {
  constructor(private readonly limits: TestInstanceLimits) {}

  @Get()
  read(): Promise<TestInstanceSettings> {
    return this.limits.read();
  }

  @Put()
  async change(
    @Body(new ContractPipe(testInstanceSettingsSchema)) settings: TestInstanceSettings,
  ): Promise<TestInstanceSettings> {
    const problems = this.limits.problemsOf(settings);
    if (problems.length > 0) throw new BadRequestException(problems.join("; "));
    return this.limits.change(settings);
  }
}
