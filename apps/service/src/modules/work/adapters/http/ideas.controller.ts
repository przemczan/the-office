import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseFilters } from "@nestjs/common";
import {
  newIdeaSchema,
  type Idea as IdeaResponse,
  type History,
  type NewIdea,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { IdeaService } from "../../application/idea-service.js";
import { toHistoryResponse, toIdeaResponse } from "./work-responses.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("ideas")
@UseFilters(WorkRefusalsFilter)
export class IdeasController {
  constructor(private readonly ideas: IdeaService) {}

  @Post()
  async capture(
    @Body(new ContractPipe(newIdeaSchema)) given: NewIdea,
    @SignedIn() signedIn: SignedIn,
  ): Promise<IdeaResponse> {
    const idea = await this.ideas.capture(
      { title: given.title, notes: given.notes, projectId: given.projectId ?? undefined },
      authorOf(signedIn),
    );
    return toIdeaResponse(idea);
  }

  /** Every Idea, the newest captured first. */
  @Get()
  async list(): Promise<IdeaResponse[]> {
    return (await this.ideas.list()).map(toIdeaResponse);
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<IdeaResponse> {
    return toIdeaResponse(await this.ideas.read(id));
  }

  /** Its History, oldest first: the edits of its title, notes and Project, with who made each. */
  @Get(":id/history")
  async history(@Param("id", ParseUUIDPipe) id: string): Promise<History> {
    return toHistoryResponse(await this.ideas.history(id));
  }
}
