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
  decisionFormAnswerSchema,
  type Decision as DecisionResponse,
  type DecisionFormAnswer,
  type Thread as ThreadResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { BugTaskDecisions } from "../../application/bug-task-decisions.js";
import { DecisionService } from "../../application/decision-service.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { toDecisionResponse, toThreadResponse } from "./conversation-responses.js";
import { ThreadRefusalsFilter } from "./thread-refusals.filter.js";

@Controller()
@UseFilters(ThreadRefusalsFilter)
export class DecisionsController {
  constructor(
    private readonly decisions: DecisionService,
    private readonly bugTasks: BugTaskDecisions,
    private readonly contexts: ThreadContexts,
  ) {}

  /** Every Decision waiting on the user, the first asked first: Waiting on you, and Needs you. */
  @Get("decisions/open")
  async listOpen(): Promise<DecisionResponse[]> {
    // The Decision's own fields alone: Needs you reads the Initiative of one on no Task from Now.
    return (await this.decisions.listOpen()).map(({ initiativeId: _initiativeId, ...decision }) =>
      toDecisionResponse(decision),
    );
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
   * takes it in its Thread, which this answers with: the form submitted, or Ask me again; or
   * Dismiss, which closes it and reaches the person only with the user's next message there. A
   * bug-task Decision's Create the Bug Task creates the Task first, with the form's `bugTask`.
   */
  @Post("decisions/:id/answer")
  @HttpCode(HttpStatus.ACCEPTED)
  async answer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(decisionFormAnswerSchema)) answer: DecisionFormAnswer,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ThreadResponse> {
    const thread = await this.bugTasks.answer(id, answer, {
      kind: "user",
      user: userOf(signedIn),
    });
    // A chat has no Decisions, so this Thread takes no part in the record of what was seen.
    return toThreadResponse(thread, await this.contexts.read(thread), undefined);
  }
}
