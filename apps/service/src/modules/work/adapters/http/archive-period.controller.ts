import { Body, Controller, Get, Put } from "@nestjs/common";
import { archivePeriodSchema, type ArchivePeriod } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeLimits } from "../../application/office-limits.js";

/** Settings › Office limits: the Archive period, in days. */
@Controller("settings/archive-period")
export class ArchivePeriodController {
  constructor(private readonly limits: OfficeLimits) {}

  @Get()
  async read(): Promise<ArchivePeriod> {
    return { archivePeriod: await this.limits.archivePeriod() };
  }

  @Put()
  async change(
    @Body(new ContractPipe(archivePeriodSchema)) { archivePeriod }: ArchivePeriod,
  ): Promise<ArchivePeriod> {
    await this.limits.changeArchivePeriod(archivePeriod);
    return { archivePeriod };
  }
}
