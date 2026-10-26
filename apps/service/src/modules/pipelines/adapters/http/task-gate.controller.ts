import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  sendBackSchema,
  type SendBack,
  type TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { GateService } from "../../application/gate-service.js";
import type { StageProgress } from "../../domain/stage-progress.js";
import { GateRefusalsFilter } from "./gate-refusals.filter.js";
import { toTaskStageResponse } from "./pipeline-responses.js";

/** The actions at the Gate a Task waits at; each answers the Task's Stages after it. */
@Controller("tasks/:id/gate")
@UseFilters(GateRefusalsFilter)
export class TaskGateController {
  constructor(private readonly gates: GateService) {}

  /** Continue: the work goes on to the Stage after the Gate. */
  @Post("continue")
  @HttpCode(HttpStatus.OK)
  async continue(@Param("id", ParseUUIDPipe) id: string): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.gates.continue(id));
  }

  /** Send back: the chosen earlier Agent Stage runs again with the feedback, using no round. */
  @Post("send-back")
  @HttpCode(HttpStatus.OK)
  async sendBack(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(sendBackSchema)) { stageKey, feedback }: SendBack,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.gates.sendBack(id, stageKey, feedback));
  }

  /** Drop: the Task is dropped at the Gate. */
  @Post("drop")
  @HttpCode(HttpStatus.OK)
  async drop(@Param("id", ParseUUIDPipe) id: string): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.gates.drop(id));
  }
}

function toTaskStagesResponse(progress: readonly StageProgress[]): TaskStagesResponse {
  return { stages: progress.map(toTaskStageResponse) };
}
