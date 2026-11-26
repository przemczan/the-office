import { Controller, Get } from "@nestjs/common";
import { type StandInChoicesResponse } from "@the-office/contracts";
import { StandInChoices, type WaitingStandInChoice } from "../../application/stand-in-choices.js";

/**
 * The Stages waiting for the user's choice of a Stand-in Engine (spec 5.4), The Office's own
 * Decision in Needs you. Switch now on them is an Office action (`SWITCH_TO_STAND_IN_ACTION`).
 */
@Controller("stand-in-choices")
export class StandInChoicesController {
  constructor(private readonly choices: StandInChoices) {}

  @Get()
  async list(): Promise<StandInChoicesResponse> {
    return { choices: (await this.choices.waiting()).map(toStandInChoiceResponse) };
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
