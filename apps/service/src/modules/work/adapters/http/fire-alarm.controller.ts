import { Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import type { FireAlarm as FireAlarmResponse } from "@the-office/contracts";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import type { FireAlarm } from "../../domain/fire-alarm.js";

/** The top bar's fire alarm (spec §2.8): read it, and sound it, which needs no confirmation. */
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
}

function toFireAlarmResponse(alarm: FireAlarm): FireAlarmResponse {
  return alarm.on ? { on: true, since: alarm.since.toISOString() } : { on: false };
}
