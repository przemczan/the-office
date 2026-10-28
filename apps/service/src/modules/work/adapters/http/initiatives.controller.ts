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
  newTaskSchema,
  type Initiative as InitiativeResponse,
  type NewTask,
  type Task as TaskResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { THE_USER } from "../../domain/author.js";
import type { Initiative } from "../../domain/initiative.js";
import { toInitiativeResponse, toTaskResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** An Initiative is made by shaping an Idea: POST /ideas/:id/initiative. */
@Controller("initiatives")
@UseFilters(WorkRefusalsFilter)
export class InitiativesController {
  constructor(private readonly initiatives: InitiativeService) {}

  /** Every Initiative, the newest first. */
  @Get()
  async list(): Promise<InitiativeResponse[]> {
    const [initiatives, tasks] = await Promise.all([
      this.initiatives.list(),
      this.initiatives.tasksByInitiative(),
    ]);
    return initiatives.map((initiative) =>
      toInitiativeResponse(initiative, tasks.get(initiative.id) ?? []),
    );
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.read(id));
  }

  /** "Confirm the Initiative": active, or done at once when its Tasks already are. */
  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  async confirm(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.confirm(id));
  }

  /** Its Tasks stay as they are. */
  @Post(":id/drop")
  @HttpCode(HttpStatus.OK)
  async drop(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.drop(id));
  }

  /** A new Task in the Initiative, in Backlog in its Project. */
  @Post(":id/tasks")
  async addTask(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newTaskSchema)) given: NewTask,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.initiatives.addTask(id, given, THE_USER));
  }

  private async respond(initiative: Initiative): Promise<InitiativeResponse> {
    const tasks = await this.initiatives.tasksByInitiative();
    return toInitiativeResponse(initiative, tasks.get(initiative.id) ?? []);
  }
}
