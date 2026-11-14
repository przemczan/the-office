import { Body, Controller, Get, Param, Put, UseFilters } from "@nestjs/common";
import { dutyChangeSchema, type Duty, type DutyChange } from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { Duties, type DutyWithHolder } from "../../application/duties.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

/** Settings › Duties: who holds each duty, and the user's changes to them (spec §2.2). */
@Controller("settings/duties")
@UseFilters(RoleRefusalsFilter)
export class DutiesController {
  constructor(private readonly duties: Duties) {}

  @Get()
  async list(): Promise<Duty[]> {
    return (await this.duties.list()).map(toDutyResponse);
  }

  @Put(":duty")
  async change(
    @Param("duty") duty: string,
    @Body(new ContractPipe(dutyChangeSchema)) { roleKey }: DutyChange,
  ): Promise<Duty> {
    return toDutyResponse(await this.duties.change(duty, roleKey));
  }
}

function toDutyResponse(duty: DutyWithHolder): Duty {
  return {
    key: duty.duty,
    label: duty.label,
    defaultRoleKey: duty.defaultRoleKey,
    set: duty.set,
    roleKey: duty.roleKey,
    holder: duty.holder && { ...duty.holder },
    fallback: duty.fallback,
  };
}
