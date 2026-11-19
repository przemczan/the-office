import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import {
  standInSwitchRequestSchema,
  type StandInChoicesResponse,
  type StandInSwitchRequest,
  type StandInSwitchResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { StandInChoices, type WaitingStandInChoice } from "../../application/stand-in-choices.js";
import { StandInSwitches } from "../../application/stand-in-switches.js";

/**
 * The Stages waiting for the user's choice of a Stand-in Engine (spec 5.4), The Office's own
 * Decision in Needs you, and Switch now on them.
 */
@Controller("stand-in-choices")
export class StandInChoicesController {
  constructor(
    private readonly choices: StandInChoices,
    private readonly switches: StandInSwitches,
  ) {}

  @Get()
  async list(): Promise<StandInChoicesResponse> {
    return { choices: (await this.choices.waiting()).map(toStandInChoiceResponse) };
  }

  /** Switches each held run on its own, answering a result for each. */
  @Post("switch")
  @HttpCode(HttpStatus.OK)
  async switch(
    @Body(new ContractPipe(standInSwitchRequestSchema)) { runIds }: StandInSwitchRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<StandInSwitchResponse> {
    return { results: await this.switches.switch(runIds, userOf(signedIn)) };
  }
}

function toStandInChoiceResponse(
  choice: WaitingStandInChoice,
): StandInChoicesResponse["choices"][number] {
  return {
    runId: choice.runId,
    taskId: choice.taskId,
    taskTitle: choice.taskTitle,
    projectId: choice.projectId,
    stageKey: choice.stageKey,
    stageName: choice.stageName,
    engineName: choice.fromEngineName,
    resetsAt: choice.resetsAt,
    contextTokens: choice.asked.contextTokens,
    askAbove: choice.asked.askAbove,
    standIn: choice.standInNow,
    waitingSince: choice.waitingSince.toISOString(),
  };
}
