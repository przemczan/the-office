import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  causedByChangeSchema,
  commitMessageChangeSchema,
  foundInVersionChangeSchema,
  newTaskSchema,
  taskListQuerySchema,
  tagsChangeSchema,
  taskMoveCheckQuerySchema,
  type CausedByChange,
  type CommitMessageChange,
  type History,
  type FoundInVersionChange,
  type NewTask,
  type Readiness,
  type TaskListQuery,
  type StartCheck,
  type TagsChange,
  type Task as TaskResponse,
  type TaskSummary as TaskSummaryResponse,
  type TaskMoveCheckQuery,
  type TaskMoveCheck,
  type TaskWaysBack as TaskWaysBackResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PlanningService } from "../../application/planning-service.js";
import { SearchService } from "../../application/search-service.js";
import { StartService } from "../../application/start-service.js";
import { TaskService } from "../../application/task-service.js";
import { TaskWaysBack } from "../../application/task-ways-back.js";
import { reasonsOf } from "../../domain/wait.js";
import { searchedQuery } from "./searched-query.js";
import { authorOf } from "./signed-in-author.js";
import { toHistoryResponse, toUsageEstimateResponse } from "./work-responses.js";
import { TaskResponses } from "./task-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("tasks")
@UseFilters(WorkRefusalsFilter)
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly planning: PlanningService,
    private readonly starting: StartService,
    private readonly search: SearchService,
    private readonly responses: TaskResponses,
    private readonly waysBack: TaskWaysBack,
  ) {}

  @Post()
  async create(
    @Body(new ContractPipe(newTaskSchema)) given: NewTask,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.create(given, authorOf(signedIn)));
  }

  /**
   * The Tasks on the board matching the query, every one without one, in the board's order; or
   * the archived Tasks, archived last first. Without their long texts, which `read` answers.
   */
  @Get()
  async list(
    @Query(new ContractPipe(taskListQuerySchema)) { query, archived }: TaskListQuery,
  ): Promise<TaskSummaryResponse[]> {
    const listed = archived
      ? await this.tasks.archived()
      : await this.search.tasksMatching(searchedQuery(query));
    return this.responses.summaries(listed);
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.read(id));
  }

  /** Its History, oldest first: its state changes and the edits of its fields, with who made each. */
  @Get(":id/history")
  async history(@Param("id", ParseUUIDPipe) id: string): Promise<History> {
    return toHistoryResponse(await this.tasks.history(id));
  }

  /** The Task whose work caused this Bug, or null for none. */
  @Put(":id/caused-by")
  async changeCausedBy(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(causedByChangeSchema)) { causedBy }: CausedByChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.changeCausedBy(id, causedBy ?? undefined));
  }

  /** The version the Bug was found in, free text, or null for none. */
  @Put(":id/found-in-version")
  async changeFoundInVersion(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(foundInVersionChangeSchema)) { foundInVersion }: FoundInVersionChange,
  ): Promise<TaskResponse> {
    return this.responses.task(
      await this.tasks.changeFoundInVersion(id, foundInVersion ?? undefined),
    );
  }

  /** The user's commit message, until Publish lands it (spec §2.3). */
  @Put(":id/commit-message")
  async changeCommitMessage(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(commitMessageChangeSchema)) { message }: CommitMessageChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.changeCommitMessage(id, message));
  }

  @Put(":id/tags")
  async changeTags(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(tagsChangeSchema)) { tags }: TagsChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.changeTags(id, tags));
  }

  /** The "Before Ready" checklist: what Mark Ready waits for, and what is met already. */
  @Get(":id/readiness")
  async readiness(@Param("id", ParseUUIDPipe) id: string): Promise<Readiness> {
    const lines = await this.planning.readiness(id);
    return {
      lines: lines.map(({ part, label, problems }) => ({
        part,
        label,
        met: problems.length === 0,
        problems: [...problems],
      })),
    };
  }

  /**
   * Why the Task can't start now, refusals apart from waits, the blockers holding it back, its
   * Overlaps, its Usage estimate and what starting it anyway past its usage caps does, for the Task
   * page beside Start.
   */
  @Get(":id/start")
  async startCheck(@Param("id", ParseUUIDPipe) id: string): Promise<StartCheck> {
    const { refusals, waits, blockers, overlaps, usageEstimate, pastUsageCaps } =
      await this.starting.check(id);
    return {
      refusals: [...refusals],
      waits: reasonsOf(waits),
      blockers: blockers.map(({ id: taskId, title }) => ({ taskId, title })),
      overlaps: overlaps.map(({ taskId, title }) => ({ taskId, title })),
      usageEstimate: usageEstimate ? toUsageEstimateResponse(usageEstimate) : null,
      pastUsageCaps: pastUsageCaps
        ? {
            passes: [...pastUsageCaps.passes],
            engines: pastUsageCaps.engines.map(({ name, standingInFor }) => ({
              name,
              standingInFor: standingInFor ?? null,
            })),
            refusals: [...pastUsageCaps.refusals],
          }
        : null,
    };
  }

  /**
   * The Task's ways back (spec 2.4.5): Restart from… and Start over for a Task Paused by the user,
   * Reopen… to Backlog or Ready for a Dropped one, each offered or why not (null where the Task's
   * state has no such way back), whether it had started and where a reset takes its branch.
   */
  @Get(":id/ways-back")
  async waysBackOf(@Param("id", ParseUUIDPipe) id: string): Promise<TaskWaysBackResponse> {
    const { restart, startOver, reopen, reopenToReady, started, resetTo } =
      await this.waysBack.waysBack(id);
    return { restart, startOver, reopen, reopenToReady, started, resetTo };
  }

  /** Move's check: every reason the Task can't move to another Project now. */
  @Get(":id/move")
  async moveCheck(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(taskMoveCheckQuerySchema)) { projectId }: TaskMoveCheckQuery,
  ): Promise<TaskMoveCheck> {
    return { problems: [...(await this.tasks.moveProblems(id, projectId))] };
  }
}
