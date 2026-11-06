import {
  Body,
  Controller,
  Delete,
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
  definitionOfDoneChangeSchema,
  descriptionChangeSchema,
  newDependencySchema,
  newTaskSchema,
  pipelineChangeSchema,
  planChangeSchema,
  priorityChangeSchema,
  searchQuerySchema,
  tagsChangeSchema,
  taskPlacementSchema,
  type DefinitionOfDoneChange,
  type DescriptionChange,
  type NewDependency,
  type NewTask,
  type PipelineChange,
  type PlanChange,
  type PriorityChange,
  type Readiness,
  type SearchQuery,
  startRequestSchema,
  type StartAnswer,
  type StartCheck,
  type StartRequest,
  type TagsChange,
  type Task as TaskResponse,
  type TaskPlacement,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PlanningService } from "../../application/planning-service.js";
import { SearchService } from "../../application/search-service.js";
import { QueueService } from "../../application/queue-service.js";
import { StartService } from "../../application/start-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import { toQueueResponse, toTaskResponse, toUsageEstimateResponse } from "./work-responses.js";
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
  ) {}

  @Post()
  async create(@Body(new ContractPipe(newTaskSchema)) given: NewTask): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.create(given, THE_USER));
  }

  /** The Tasks matching the query, every Task without one, in the board's order. */
  @Get()
  async list(
    @Query(new ContractPipe(searchQuerySchema)) { query }: SearchQuery,
  ): Promise<TaskResponse[]> {
    return (await this.search.tasksMatching(query)).map(toTaskResponse);
  }

  @Get(":id")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.read(id));
  }

  @Put(":id/priority")
  async changePriority(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(priorityChangeSchema)) { priority }: PriorityChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.changePriority(id, priority));
  }

  /** The user's Description, until the Task starts. */
  @Put(":id/description")
  async changeDescription(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(descriptionChangeSchema)) { description }: DescriptionChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.changeDescription(id, description));
  }

  @Put(":id/tags")
  async changeTags(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(tagsChangeSchema)) { tags }: TagsChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.changeTags(id, tags));
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
    return toTaskResponse(task);
  }

  /** The Task waits for another to be Done before it can start, in any Project. */
  @Post(":id/dependencies")
  @HttpCode(HttpStatus.OK)
  async addDependency(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(newDependencySchema)) { blockerId }: NewDependency,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.addDependency(id, blockerId));
  }

  @Delete(":id/dependencies/:blockerId")
  async removeDependency(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("blockerId", ParseUUIDPipe) blockerId: string,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.removeDependency(id, blockerId));
  }

  /**
   * Plan with…: the Task moves to Planning, and its planning Thread opens for the user's first
   * message.
   */
  @Post(":id/planning")
  @HttpCode(HttpStatus.OK)
  async plan(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.plan(id));
  }

  /**
   * Make a plan: the Task moves to Planning, and the Planner starts at once from its title and
   * Description.
   */
  @Post(":id/make-a-plan")
  @HttpCode(HttpStatus.OK)
  async makeAPlan(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.makeAPlan(id));
  }

  /** Save: the user's Plan, unconfirmed once changed; a change moves a Ready Task to Backlog. */
  @Put(":id/plan")
  async savePlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(planChangeSchema)) change: PlanChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.savePlan(id, change));
  }

  /** Confirm: the Plan as it reads. */
  @Post(":id/plan/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmPlan(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmPlan(id));
  }

  /** Save, as with the Plan. */
  @Put(":id/definition-of-done")
  async saveDefinitionOfDone(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(definitionOfDoneChangeSchema))
    { definitionOfDone }: DefinitionOfDoneChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.saveDefinitionOfDone(id, definitionOfDone));
  }

  /** Confirm: the Definition of Done as it reads. */
  @Post(":id/definition-of-done/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmDefinitionOfDone(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmDefinitionOfDone(id));
  }

  /** The Task's Pipeline, set by the user: the proposed one confirmed, or another. */
  @Put(":id/pipeline")
  async confirmPipeline(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(pipelineChangeSchema)) { pipelineId }: PipelineChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmPipeline(id, pipelineId));
  }

  /**
   * Mark Ready, from Backlog or Planning: refused with the reasons until the Plan and Definition of
   * Done are confirmed, no Pipeline proposal is open and no Decision is.
   */
  @Post(":id/ready")
  @HttpCode(HttpStatus.OK)
  async markReady(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.markReady(id));
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
   * Overlaps and its Usage estimate, for the Task page beside Start.
   */
  @Get(":id/start")
  async startCheck(@Param("id", ParseUUIDPipe) id: string): Promise<StartCheck> {
    const { refusals, waits, blockers, overlaps, usageEstimate } = await this.starting.check(id);
    return {
      refusals: [...refusals],
      waits: [...waits],
      blockers: blockers.map(({ id: taskId, title }) => ({ taskId, title })),
      overlaps: overlaps.map(({ taskId, title, files }) => ({ taskId, title, files: [...files] })),
      usageEstimate: usageEstimate ? toUsageEstimateResponse(usageEstimate) : null,
    };
  }

  /**
   * Start: Ready → In progress, or into the queue when only a blocker or a limit holds it or the
   * user queues it behind an Overlap; refused with the reasons when anything else does, or an
   * Overlap the user hasn't answered.
   */
  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  async start(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(startRequestSchema)) { onOverlap }: StartRequest,
  ): Promise<StartAnswer> {
    const starting = await this.starting.start(id, onOverlap);
    if (starting.kind === "started") {
      return { task: toTaskResponse(starting.change.task), queued: null };
    }
    const queued = toQueueResponse(await this.queue.list()).find(({ taskId }) => taskId === id);
    return { task: toTaskResponse(await this.tasks.read(id)), queued: queued ?? null };
  }

  /** Pause: the Task is held, its running Stage once the Agent's current turn ends. */
  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  async pause(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.pause(id));
  }

  /** Stop: the Stage running now is interrupted, its uncommitted edits discarded, the Task held. */
  @Post(":id/stop")
  @HttpCode(HttpStatus.OK)
  async stop(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.stop(id));
  }

  /** Resume: a Paused Task goes on through the Context policy. */
  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  async resume(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.resume(id));
  }

  @Post(":id/drop")
  @HttpCode(HttpStatus.OK)
  async drop(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.drop(id));
  }
}
