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
  causedByChangeSchema,
  commitMessageChangeSchema,
  foundInVersionChangeSchema,
  workEngineChangeSchema,
  makeAPlanSchema,
  markReadyRequestSchema,
  newTaskSchema,
  pipelineChangeSchema,
  taskListQuerySchema,
  tagsChangeSchema,
  taskMoveCheckQuerySchema,
  taskMoveSchema,
  taskPlacementSchema,
  type CausedByChange,
  type CommitMessageChange,
  type History,
  type FoundInVersionChange,
  type WorkEngineChange,
  type MakeAPlan,
  type MarkReadyRequest,
  type NewTask,
  type PipelineChange,
  type Readiness,
  type TaskListQuery,
  startRequestSchema,
  type StartAnswer,
  type StartCheck,
  type StartRequest,
  type TagsChange,
  type Task as TaskResponse,
  type TaskSummary as TaskSummaryResponse,
  type TaskMove,
  type TaskMoveCheckQuery,
  type TaskMoveCheck,
  type TaskPlacement,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { PlanningService } from "../../application/planning-service.js";
import { SearchService } from "../../application/search-service.js";
import { QueueService } from "../../application/queue-service.js";
import { StartService } from "../../application/start-service.js";
import { TaskService } from "../../application/task-service.js";
import { reasonsOf } from "../../domain/wait.js";
import { searchedQuery } from "./searched-query.js";
import { authorOf } from "./signed-in-author.js";
import { toHistoryResponse, toQueueResponse, toUsageEstimateResponse } from "./work-responses.js";
import { TaskResponses } from "./task-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("tasks")
@UseFilters(WorkRefusalsFilter)
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly planning: PlanningService,
    private readonly starting: StartService,
    private readonly queue: QueueService,
    private readonly search: SearchService,
    private readonly responses: TaskResponses,
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

  /**
   * The Task's engine override (spec 5.4.5), an engine only, null for none, in any state but Done
   * and Dropped; refused for an engine not listed, and when a Role of its Pipeline couldn't run on it.
   */
  @Put(":id/engine")
  async setEngine(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(workEngineChangeSchema)) { engineId }: WorkEngineChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.setEngine(id, engineId));
  }

  @Put(":id/tags")
  async changeTags(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(tagsChangeSchema)) { tags }: TagsChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.changeTags(id, tags));
  }

  @Put(":id/place")
  async reorder(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskPlacementSchema)) { above, below }: TaskPlacement,
  ): Promise<TaskResponse> {
    const task = await this.tasks.reorder(id, {
      above: above ?? undefined,
      below: below ?? undefined,
    });
    return this.responses.task(task);
  }

  /**
   * Plan with…: the Task moves to Planning, and its planning Thread opens for the user's first
   * message.
   */
  @Post(":id/planning")
  @HttpCode(HttpStatus.OK)
  async plan(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.planning.plan(id, authorOf(signedIn)));
  }

  /**
   * Make a plan: the Task moves to Planning, in auto mode or not, and the Planner starts at once
   * from its title and Description. The choice becomes the remembered default.
   */
  @Post(":id/make-a-plan")
  @HttpCode(HttpStatus.OK)
  async makeAPlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(makeAPlanSchema)) { autoMode }: MakeAPlan,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.planning.makeAPlan(id, autoMode, authorOf(signedIn)));
  }

  /** Confirm: the Plan as it reads. */
  @Post(":id/plan/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmPlan(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return this.responses.task(await this.planning.confirmPlan(id));
  }

  /** Confirm: the Definition of Done as it reads. */
  @Post(":id/definition-of-done/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmDefinitionOfDone(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return this.responses.task(await this.planning.confirmDefinitionOfDone(id));
  }

  /** The Task's Pipeline, set by the user: the proposed one confirmed, or another. */
  @Put(":id/pipeline")
  async confirmPipeline(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(pipelineChangeSchema)) { pipelineId }: PipelineChange,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.planning.confirmPipeline(id, pipelineId));
  }

  /**
   * Mark Ready, from Backlog or Planning: refused with the reasons until the Plan and Definition of
   * Done are confirmed, no Pipeline proposal is open and no Decision is. With
   * `confirmPlanAndDefinitionOfDone`, the user's answer to the dialog naming what is missing, the
   * Plan and the Definition of Done are confirmed as they stand, even empty, in the same change; a
   * request with no body is one without it.
   */
  @Post(":id/ready")
  @HttpCode(HttpStatus.OK)
  async markReady(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(
      new ContractPipe(markReadyRequestSchema.default({ confirmPlanAndDefinitionOfDone: false })),
    )
    { confirmPlanAndDefinitionOfDone = false }: MarkReadyRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(
      await this.planning.markReady(id, authorOf(signedIn), { confirmPlanAndDefinitionOfDone }),
    );
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
   * Start: Ready → In progress, or into the queue when only a blocker or a limit holds it or the
   * user queues it behind an Overlap; refused with the reasons when anything else does, or an
   * Overlap the user hasn't answered. Started anyway past the usage caps, it never queues.
   */
  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  async start(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(startRequestSchema)) { onOverlap, onUsageCaps }: StartRequest,
    @SignedIn() signedIn: SignedIn,
  ): Promise<StartAnswer> {
    const starting = await this.starting.start(
      id,
      { onOverlap, usageCaps: onUsageCaps ?? "wait" },
      authorOf(signedIn),
    );
    if (starting.kind === "started") {
      return { task: await this.responses.task(starting.change.task), queued: null };
    }
    const queued = toQueueResponse(await this.queue.list()).find(({ taskId }) => taskId === id);
    return { task: await this.responses.task(await this.tasks.read(id)), queued: queued ?? null };
  }

  /** Pause: the Task is held, its running Stage once the Agent's current turn ends. */
  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.pause(id, authorOf(signedIn)));
  }

  /** Stop: the Stage running now is interrupted, its uncommitted edits discarded, the Task held. */
  @Post(":id/stop")
  @HttpCode(HttpStatus.OK)
  async stop(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.stop(id, authorOf(signedIn)));
  }

  /** Resume: a Paused Task goes on through the Context policy. */
  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param("id", ParseUUIDPipe) id: string,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.resume(id, authorOf(signedIn)));
  }

  /** Move's check: every reason the Task can't move to another Project now. */
  @Get(":id/move")
  async moveCheck(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(taskMoveCheckQuerySchema)) { projectId }: TaskMoveCheckQuery,
  ): Promise<TaskMoveCheck> {
    return { problems: [...(await this.tasks.moveProblems(id, projectId))] };
  }

  /** Move: the Task goes to another Project, back in Backlog with both parts Not confirmed. */
  @Post(":id/move")
  @HttpCode(HttpStatus.OK)
  async move(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskMoveSchema)) { projectId }: TaskMove,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TaskResponse> {
    return this.responses.task(await this.tasks.move(id, projectId, authorOf(signedIn)));
  }
}
