import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters } from "@nestjs/common";
import {
  allClearSchema,
  soundFireAlarmSchema,
  type AllClear,
  type FireAlarm as FireAlarmResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import type { FireAlarm, FireAlarmWay } from "../../domain/fire-alarm.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * The top bar's fire alarm (spec §2.8): read it, sound it one of its ways, which needs no
 * confirmation, and give the all clear with what Now's plan holds or drops.
 */
@Controller("fire-alarm")
@UseFilters(WorkRefusalsFilter)
export class FireAlarmController {
  constructor(private readonly fireAlarm: FireAlarmService) {}

  @Get()
  async read(): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.read());
  }

  @Post("sound")
  @HttpCode(HttpStatus.OK)
  async sound(
    @Body(new ContractPipe(soundFireAlarmSchema)) { way }: { way: FireAlarmWay },
  ): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.sound(way));
  }

  @Post("all-clear")
  @HttpCode(HttpStatus.OK)
  async allClear(
    @Body(new ContractPipe(allClearSchema)) choices: AllClear,
    @SignedIn() signedIn: SignedIn,
  ): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.giveAllClear(choices, authorOf(signedIn)));
  }
}

function toFireAlarmResponse(alarm: FireAlarm): FireAlarmResponse {
  return alarm.on ? { on: true, since: alarm.since.toISOString(), way: alarm.way } : { on: false };
}
