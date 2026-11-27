import { Controller, Get, UseFilters } from "@nestjs/common";
import type { Duty } from "@the-office/contracts";
import { Duties } from "../../application/duties.js";
import { toDutyResponse } from "./duty-responses.js";
import { RoleRefusalsFilter } from "./role-refusals.filter.js";

/** Settings › Duties: who holds each duty (spec §2.2); `set_duty_holder` changes them. */
@Controller("settings/duties")
@UseFilters(RoleRefusalsFilter)
export class DutiesController {
  constructor(private readonly duties: Duties) {}

  @Get()
  async list(): Promise<Duty[]> {
    return (await this.duties.list()).map(toDutyResponse);
  }
}
