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
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  archivedInitiativesQuerySchema,
  initiativePipelineChoiceSchema,
  initiativePipelinesChangeSchema,
  initiativePlanningSchema,
  newInitiativeTaskSchema,
  outcomeChangeSchema,
  searchQuerySchema,
  shortNameChangeSchema,
  type ArchivedInitiativesPage,
  type ArchivedInitiativesQuery,
  type Initiative as InitiativeResponse,
  type InitiativePauseAnswer,
  type InitiativePipelineChoice,
  type InitiativePipelinesChange,
  type InitiativePlanningRequest,
  type NewInitiativeTask,
  type OutcomeChange,
  type ReadyTasksStarted,
  type SearchQuery,
  type ShortNameChange,
  type Task as TaskResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import {
  InitiativePause,
  type InitiativePauseOutcome,
} from "../../application/initiative-pause.js";
import { InitiativePlanning } from "../../application/initiative-planning.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { InitiativeStart } from "../../application/initiative-start.js";
import type { Initiative } from "../../domain/initiative.js";
import {
  toArchivedInitiativesPageResponse,
  toInitiativeResponse,
  toTaskResponse,
} from "./work-responses.js";
import { authorOf } from "./signed-in-author.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

/** An Initiative is made by shaping an Idea: POST /ideas/:id/initiative. */
@Controller("initiatives")
@UseFilters(WorkRefusalsFilter)
export class InitiativesController {
  constructor(
    private readonly initiatives: InitiativeService,
    private readonly planning: InitiativePlanning,
    private readonly starting: InitiativeStart,
    private readonly pausing: InitiativePause,
  ) {}

  /**
   * Every Initiative matching the query by its name and outcome, every one without, archived ones
   * too, the newest first: the Work board, Ideas and mentions name an archived one's Tasks by it.
   */
  @Get()
  async list(
    @Query(new ContractPipe(searchQuerySchema)) { query }: SearchQuery,
  ): Promise<InitiativeResponse[]> {
    const [initiatives, tasks] = await Promise.all([
      this.initiatives.list(query),
      this.initiatives.tasksByInitiative(),
    ]);
    return initiatives.map((initiative) =>
      toInitiativeResponse(initiative, tasks.get(initiative.id) ?? []),
    );
  }

  /** A page of the Archive, searched, filtered and counted in the store. */
  @Get("archived")
  async archived(
    @Query(new ContractPipe(archivedInitiativesQuerySchema))
    { query, state, page, project }: ArchivedInitiativesQuery,
  ): Promise<ArchivedInitiativesPage> {
    const search = { state, page, projects: project };
    return toArchivedInitiativesPageResponse(
      await this.initiatives.archived(query, search),
      search,
    );
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.read(id));
  }

  /** "Confirm the Initiative": active, or done at once when its Tasks already are. */
  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.confirm(id, authorOf(signedIn)));
  }

  /** The user's outcome; refused once the Initiative is no longer being shaped. */
  @Put(":id/outcome")
  async writeOutcome(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(outcomeChangeSchema)) { outcome }: OutcomeChange,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.writeOutcome(id, outcome, "straight"));
  }

  /**
   * The user's choice of the Initiative's Pipeline in one Project it spans, null for None; refused
   * once the Initiative is no longer being shaped, where only a Proposal of whoever shapes
   * Initiatives changes it.
   */
  @Put(":id/pipeline")
  async choosePipeline(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(initiativePipelineChoiceSchema))
    { projectId, pipelineId }: InitiativePipelineChoice,
  ): Promise<InitiativeResponse> {
    return this.respond(
      await this.initiatives.choosePipeline(id, projectId, pipelineId, "straight"),
    );
  }

  /**
   * The user's Pipelines block saved as a whole: every Project's Pipeline and the Short name, all
   * or nothing; refused once the Initiative is no longer being shaped.
   */
  @Put(":id/pipelines")
  async setPipelines(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(initiativePipelinesChangeSchema))
    { pipelines, shortName }: InitiativePipelinesChange,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.setPipelines(id, pipelines, shortName));
  }

  /** The user's own Short name; refused once the Initiative is no longer being shaped. */
  @Put(":id/short-name")
  async writeShortName(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(shortNameChangeSchema)) { shortName }: ShortNameChange,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.writeShortName(id, shortName));
  }

  /** Its Tasks stay as they are, and so do its branches. */
  @Post(":id/drop")
  @HttpCode(HttpStatus.OK)
  async drop(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.drop(id, authorOf(signedIn)));
  }

  /** Takes a Done or Dropped Initiative off the board into the Archive; its state stays. */
  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  async archive(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.archive(id, authorOf(signedIn)));
  }

  /** Puts an archived Initiative back on the board, in Done or Dropped as it was. */
  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.initiatives.restore(id, authorOf(signedIn)));
  }

  /**
   * A new shaping Thread with whoever shapes Initiatives, who starts on it at once; its Threads are
   * listed by GET /initiatives/:id/threads.
   */
  @Post(":id/shaping")
  @HttpCode(HttpStatus.OK)
  async shape(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeResponse> {
    await this.initiatives.startShapingThread(id);
    return this.respond(await this.initiatives.read(id));
  }

  /**
   * Plan the Initiative: a new planning Thread with the Planner, who plans its Backlog Tasks at
   * once, in auto mode or not, which becomes the remembered default; its Threads are listed by
   * GET /initiatives/:id/threads.
   */
  @Post(":id/planning")
  @HttpCode(HttpStatus.OK)
  async plan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(initiativePlanningSchema)) { autoMode }: InitiativePlanningRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.planning.plan(id, autoMode, authorOf(signedIn)));
  }

  /**
   * Plan with…: a new planning Thread with the Planner, who waits for the user's first message on
   * how to plan the Initiative, with auto mode off and the remembered default left as it is.
   */
  @Post(":id/plan-with")
  @HttpCode(HttpStatus.OK)
  async planWith(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativeResponse> {
    return this.respond(await this.planning.planWith(id, authorOf(signedIn)));
  }

  /**
   * Start Ready Tasks: the normal Start on each of the Initiative's Ready Tasks, an Overlap queued
   * behind; what started, what was queued and what was refused, each with its reasons.
   */
  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  async startReadyTasks(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<ReadyTasksStarted> {
    const { started, queued, refused } = await this.starting.startReadyTasks(
      id,
      authorOf(signedIn),
    );
    return {
      started: started.map(({ id: taskId, title }) => ({ taskId, title })),
      queued: queued.map(({ task, place, reasons }) => ({
        taskId: task.id,
        title: task.title,
        place,
        reasons: [...reasons],
      })),
      refused: refused.map(({ task, reasons }) => ({
        taskId: task.id,
        title: task.title,
        reasons: [...reasons],
      })),
    };
  }

  /**
   * Pause the Initiative: pauses its Tasks In progress or Waiting on you, and holds every Start of
   * its Tasks until it is resumed; refused unless it is active and not paused.
   */
  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativePauseAnswer> {
    return this.respondToPause(await this.pausing.pause(id, authorOf(signedIn)));
  }

  /**
   * Resume the Initiative: resumes the Tasks its Pause paused and lets its queued Tasks start;
   * refused unless it is paused.
   */
  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<InitiativePauseAnswer> {
    return this.respondToPause(await this.pausing.resume(id, authorOf(signedIn)));
  }

  /**
   * A new Task in the Initiative, in Shaping or Backlog in its Project, waiting for the Tasks it
   * names.
   */
  @Post(":id/tasks")
  async addTask(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newInitiativeTaskSchema)) { blockedBy, ...given }: NewInitiativeTask,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.initiatives.addTask(id, given, blockedBy, authorOf(signedIn)));
  }

  private async respondToPause({
    initiative,
    taskIds,
  }: InitiativePauseOutcome): Promise<InitiativePauseAnswer> {
    return { initiative: await this.respond(initiative), taskIds: [...taskIds] };
  }

  private async respond(initiative: Initiative): Promise<InitiativeResponse> {
    const tasks = await this.initiatives.tasksByInitiative();
    return toInitiativeResponse(initiative, tasks.get(initiative.id) ?? []);
  }
}
