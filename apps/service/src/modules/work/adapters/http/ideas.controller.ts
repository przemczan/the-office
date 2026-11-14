import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  ideaEditSchema,
  ideaShapingSchema,
  newIdeaSchema,
  type Idea as IdeaResponse,
  type IdeaEdit,
  type IdeaShaping,
  type Initiative as InitiativeResponse,
  type NewIdea,
  type Task as TaskResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { PlanningService } from "../../application/planning-service.js";
import { THE_USER } from "../../domain/author.js";
import { toIdeaResponse, toInitiativeResponse, toTaskResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("ideas")
@UseFilters(WorkRefusalsFilter)
export class IdeasController {
  constructor(
    private readonly ideas: IdeaService,
    private readonly initiatives: InitiativeService,
    private readonly planning: PlanningService,
  ) {}

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

  /** Its title, notes and Project, until it is shaped. */
  @Put(":id")
  async edit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(ideaEditSchema)) given: IdeaEdit,
  ): Promise<IdeaResponse> {
    const idea = await this.ideas.edit(id, {
      title: given.title,
      notes: given.notes,
      projectId: given.projectId ?? undefined,
    });
    return toIdeaResponse(idea);
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

  /** Shape into an Initiative: the Initiative the Idea became, being shaped, with no Tasks yet. */
  @Post(":id/initiative")
  @HttpCode(HttpStatus.CREATED)
  async shapeIntoInitiative(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    return toInitiativeResponse(await this.initiatives.shape(id, THE_USER), []);
  }

  /** Plan as a Task with the Planner: the Task the Idea became, in Planning with its Thread. */
  @Post(":id/plan")
  @HttpCode(HttpStatus.CREATED)
  async shapeAndPlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(ideaShapingSchema)) { projectId }: IdeaShaping,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.shapeAndPlan(id, projectId, THE_USER));
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
