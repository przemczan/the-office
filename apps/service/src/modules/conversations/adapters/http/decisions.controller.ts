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
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { toDecisionResponse, toThreadResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class DecisionsController {
  constructor(
    private readonly decisions: DecisionService,
    private readonly contexts: ThreadContexts,
  ) {}

  /** Every Decision waiting on the user, the first asked first: Waiting on you, and Needs you. */
  @Get("decisions/open")
  async listOpen(): Promise<DecisionResponse[]> {
    return (await this.decisions.listOpen()).map(toDecisionResponse);
  }

  /** The Task's Decisions nobody has answered, those with a Consultant too: its Needs you card. */
  @Get("tasks/:taskId/decisions/unanswered")
  async listUnansweredOn(
    @Param("taskId", ParseUUIDPipe) taskId: string,
  ): Promise<DecisionResponse[]> {
    return (await this.decisions.listUnansweredOn(taskId)).map(toDecisionResponse);
  }

  /**
   * The signed-in user's answer, to any Decision, as every user shares them; the person who asked
   * takes it in its Thread, which this answers with.
   */
  @Post("decisions/:id/answer")
  @HttpCode(HttpStatus.ACCEPTED)
  async answer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(decisionAnswerSchema)) answer: DecisionAnswer,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadResponse> {
    const thread = await this.decisions.answer(id, answer, {
      kind: "user",
      user: userOf(signedIn),
    });
    // A chat has no Decisions, so this Thread takes no part in the record of what was seen.
    return toThreadResponse(thread, await this.contexts.read(thread), undefined);
  }
}
