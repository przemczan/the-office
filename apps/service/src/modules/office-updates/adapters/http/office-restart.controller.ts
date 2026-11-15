import { Controller, Delete, HttpCode, HttpStatus, Post, UseFilters } from "@nestjs/common";
import { OfficeRestarts } from "../../application/office-restarts.js";
import { ScheduledExitRefusalsFilter } from "./scheduled-exit-refusals.filter.js";

/** Settings › Updates › Restart; `GET /office-update` shows it. */
@Controller("office-restart")
@UseFilters(ScheduledExitRefusalsFilter)
export class OfficeRestartController {
  constructor(private readonly restarts: OfficeRestarts) {}

  @Post("schedule")
  @HttpCode(HttpStatus.NO_CONTENT)
  async schedule(): Promise<void> {
    await this.restarts.schedule();
  }

  @Delete("schedule")
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(): Promise<void> {
    await this.restarts.cancel();
  }
}
