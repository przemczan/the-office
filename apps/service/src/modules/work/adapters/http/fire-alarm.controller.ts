import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseFilters } from "@nestjs/common";
import {
  allClearSchema,
  type AllClear,
  type FireAlarm as FireAlarmResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { FireAlarmService } from "../../application/fire-alarm-service.js";
import { authorOf } from "./signed-in-author.js";
import { toFireAlarmResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/**
 * The top bar's fire alarm (spec §2.8): read it, and give the all clear with what Now's plan holds
 * or drops. Sounding it is an Office action of Work.
 */
@Controller("fire-alarm")
@UseFilters(WorkRefusalsFilter)
export class FireAlarmController {
  constructor(private readonly fireAlarm: FireAlarmService) {}

  @Get()
  async read(): Promise<FireAlarmResponse> {
    return toFireAlarmResponse(await this.fireAlarm.read());
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
