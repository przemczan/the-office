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
  continueAtGateSchema,
  sendBackSchema,
  type ContinueAtGate,
  type SendBack,
  type TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { GateService } from "../../application/gate-service.js";
import { GateRefusalsFilter } from "./gate-refusals.filter.js";
import { toTaskStagesResponse } from "./pipeline-responses.js";

/** The actions at the Gate a Task waits at; each answers the Task's Stages after it. */
@Controller("tasks/:id/gate")
@UseFilters(GateRefusalsFilter)
export class TaskGateController {
  constructor(private readonly gates: GateService) {}

  /**
   * Continue: the work goes on to the Stage after the Gate, with the notes every later Agent Stage
   * is briefed with, when the body brings any. No body is plain Continue.
   */
  @Post("continue")
  @HttpCode(HttpStatus.OK)
  async continue(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(continueAtGateSchema.optional())) body: ContinueAtGate | undefined,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.gates.continue(id, userOf(signedIn), body?.feedback));
  }

  /** Send back: the chosen earlier Agent Stage runs again with the feedback, using no round. */
  @Post("send-back")
  @HttpCode(HttpStatus.OK)
  async sendBack(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(sendBackSchema)) { stageKey, feedback }: SendBack,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(
      await this.gates.sendBack(id, userOf(signedIn), stageKey, feedback),
    );
  }

  /** Drop: the Task is dropped at the Gate. */
  @Post("drop")
  @HttpCode(HttpStatus.OK)
  async drop(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.gates.drop(id, userOf(signedIn)));
  }
}
