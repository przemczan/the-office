import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  allClearSchema,
  type AllClear,
  type FireAlarm as FireAlarmResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import type { FireAlarm } from "../../domain/fire-alarm.js";

/**
 * The top bar's fire alarm (spec §2.8): read it, sound it, which needs no confirmation, and give
 * the all clear with what Now's plan holds or drops.
 */
@Controller("fire-alarm")
export class FireAlarmController {
  constructor(private readonly fireAlarm: FireAlarmService) {}

  @Get()
  async read(): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.read());
  }

  @Post("sound")
  @HttpCode(HttpStatus.OK)
  async sound(): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.sound());
  }

  @Post("all-clear")
  @HttpCode(HttpStatus.OK)
  async allClear(
    @Body(new ContractPipe(allClearSchema)) choices: AllClear,
  ): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.giveAllClear(choices));
  }
}

function toFireAlarmResponse(alarm: FireAlarm): FireAlarmResponse {
  return alarm.on ? { on: true, since: alarm.since.toISOString() } : { on: false };
}
