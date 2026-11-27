import { Controller, Get, Header, NotFoundException, UseFilters } from "@nestjs/common";
import type { OfficeUpdate } from "@the-office/contracts";
import { OfficeRestarts } from "../../application/office-restarts.js";
import { OfficeUpdates } from "../../application/office-updates.js";
import { officeUpdateResponse } from "./office-update-response.js";
import { ScheduledExitRefusalsFilter } from "./scheduled-exit-refusals.filter.js";

/** Settings › Updates. */
@Controller("office-update")
@UseFilters(ScheduledExitRefusalsFilter)
export class OfficeUpdatesController {
  constructor(
    private readonly updates: OfficeUpdates,
    private readonly restarts: OfficeRestarts,
  ) {}

  @Get()
  read(): Promise<OfficeUpdate> {
    return this.shown();
  }

  /** The log of the last update, as plain text. */
  @Get("log")
  @Header("Content-Type", "text/plain; charset=utf-8")
  async log(): Promise<string> {
    const log = await this.updates.log();
    if (log === undefined) throw new NotFoundException("No Office update has left a log.");
    return log;
  }

  private shown(): Promise<OfficeUpdate> {
    return officeUpdateResponse(this.updates, this.restarts);
  }
}
