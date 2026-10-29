import { Controller, Delete, Get, Param, ParseUUIDPipe, Put, UseFilters } from "@nestjs/common";
import type { FireAlarmLifts as FireAlarmLiftsResponse } from "@the-office/contracts";
import { FireAlarmLifts } from "../../application/fire-alarm-lifts.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

/**
 * The note under a composer while the fire alarm is on (spec §2.8): "Let <name> act in this
 * thread" lifts it for the Thread until the all clear, "Take it back" holds it again. Each answers
 * the Threads lifted now.
 */
@Controller("fire-alarm/lifts")
@UseFilters(ThreadRefusalsFilter)
export class FireAlarmLiftsController {
  constructor(private readonly lifts: FireAlarmLifts) {}

  @Get()
  async list(): Promise<FireAlarmLiftsResponse> {
    return this.liftedNow();
  }

  @Put(":threadId")
  async lift(@Param("threadId", ParseUUIDPipe) threadId: string): Promise<FireAlarmLiftsResponse> {
    await this.lifts.lift(threadId);
    return this.liftedNow();
  }

  @Delete(":threadId")
  async takeBack(
    @Param("threadId", ParseUUIDPipe) threadId: string,
  ): Promise<FireAlarmLiftsResponse> {
    await this.lifts.takeBack(threadId);
    return this.liftedNow();
  }

  private async liftedNow(): Promise<FireAlarmLiftsResponse> {
    return { threadIds: [...(await this.lifts.lifted())] };
  }
}
