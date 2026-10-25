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
  ideaShapingSchema,
  newIdeaSchema,
  type Idea as IdeaResponse,
  type IdeaShaping,
  type NewIdea,
  type Task as TaskResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { IdeaService } from "../../application/idea-service.js";
import { THE_USER } from "../../domain/author.js";
import { toIdeaResponse, toTaskResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("ideas")
@UseFilters(WorkRefusalsFilter)
export class IdeasController {
  constructor(private readonly ideas: IdeaService) {}

  @Post()
  async capture(@Body(new ContractPipe(newIdeaSchema)) given: NewIdea): Promise<IdeaResponse> {
    const idea = await this.ideas.capture(
      { title: given.title, notes: given.notes, projectId: given.projectId ?? undefined },
      THE_USER,
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

  /** The Task the Idea became. */
  @Post(":id/shape")
  @HttpCode(HttpStatus.CREATED)
  async shape(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(ideaShapingSchema)) { projectId }: IdeaShaping,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.ideas.shape(id, projectId, THE_USER));
  }

  @Post(":id/drop")
  @HttpCode(HttpStatus.OK)
  async drop(@Param("id", ParseUUIDPipe) id: string): Promise<IdeaResponse> {
    return toIdeaResponse(await this.ideas.drop(id));
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  async restore(@Param("id", ParseUUIDPipe) id: string): Promise<IdeaResponse> {
    return toIdeaResponse(await this.ideas.restore(id));
  }
}
