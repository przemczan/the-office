import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  decisionAnswerSchema,
  type DecisionAnswer,
  type Decision as DecisionResponse,
  type Thread as ThreadResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { toDecisionResponse, toThreadResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller("decisions")
@UseFilters(ThreadRefusalsFilter)
export class DecisionsController {
  constructor(
    private readonly decisions: DecisionService,
    private readonly contexts: ThreadContexts,
  ) {}

  /** Every Decision waiting on the user, the first asked first: Waiting on you, and Needs you. */
  @Get("open")
  async listOpen(): Promise<DecisionResponse[]> {
    return (await this.decisions.listOpen()).map(toDecisionResponse);
  }

  /** The user's answer; the person who asked takes it in its Thread, which this answers with. */
  @Post(":id/answer")
  @HttpCode(HttpStatus.ACCEPTED)
  async answer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(decisionAnswerSchema)) answer: DecisionAnswer,
  ): Promise<ThreadResponse> {
    const thread = await this.decisions.answer(id, answer);
    return toThreadResponse(thread, await this.contexts.read(thread));
  }
}
