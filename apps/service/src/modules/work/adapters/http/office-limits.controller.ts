import { Body, Controller, Get, Put } from "@nestjs/common";
import { officeWideLimitSchema, type OfficeWideLimit } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeLimits } from "../../application/office-limits.js";

/** Settings › Office limits: the desks, the Office-wide limit on started Tasks. */
@Controller("settings/office-wide-limit")
export class OfficeLimitsController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<OfficeWideLimit> {
    return { officeWideLimit: await this.limits.officeWideLimit() };
  }

  @Put()
  async change(
    @Body(new ContractPipe(officeWideLimitSchema)) { officeWideLimit }: OfficeWideLimit,
  ): Promise<OfficeWideLimit> {
    await this.limits.changeOfficeWideLimit(officeWideLimit);
    return { officeWideLimit };
  }
}
