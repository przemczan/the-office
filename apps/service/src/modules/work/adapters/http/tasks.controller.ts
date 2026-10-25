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
  definitionOfDoneChangeSchema,
  newTaskSchema,
  pipelineChangeSchema,
  planChangeSchema,
  priorityChangeSchema,
  taskPlacementSchema,
  type DefinitionOfDoneChange,
  type NewTask,
  type PipelineChange,
  type PlanChange,
  type PriorityChange,
  type Task as TaskResponse,
  type TaskPlacement,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import { toTaskResponse } from "./work-responses.js";
import { WorkRefusalsFilter } from "./work-refusals.filter.js";

@Controller("tasks")
@UseFilters(WorkRefusalsFilter)
export class TasksController {
  constructor(
    private readonly tasks: TaskService,
    private readonly planning: PlanningService,
  ) {}

  @Post()
  async create(@Body(new ContractPipe(newTaskSchema)) given: NewTask): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.create(given, THE_USER));
  }

  /** Every Task, in the board's order. */
  @Get()
  async list(): Promise<TaskResponse[]> {
    return (await this.tasks.list()).map(toTaskResponse);
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

  /** Plan with the Planner: the Task moves to Planning, and its planning Thread opens. */
  @Post(":id/planning")
  @HttpCode(HttpStatus.OK)
  async plan(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.plan(id));
  }

  /** The user's Plan, confirmed: the proposed one as shown, or their edit of it. */
  @Put(":id/plan")
  async confirmPlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(planChangeSchema)) { plan }: PlanChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmPlan(id, plan));
  }

  /** The user's Definition of Done, confirmed, as with the Plan. */
  @Put(":id/definition-of-done")
  async confirmDefinitionOfDone(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(definitionOfDoneChangeSchema))
    { definitionOfDone }: DefinitionOfDoneChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmDefinitionOfDone(id, definitionOfDone));
  }

  /** The Task's Pipeline, set by the user: the proposed one confirmed, or another. */
  @Put(":id/pipeline")
  async confirmPipeline(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(pipelineChangeSchema)) { pipelineId }: PipelineChange,
  ): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.confirmPipeline(id, pipelineId));
  }

  /** Mark Ready: refused with the reasons until the Plan and Definition of Done are confirmed. */
  @Post(":id/ready")
  @HttpCode(HttpStatus.OK)
  async markReady(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.planning.markReady(id));
  }

  @Post(":id/drop")
  @HttpCode(HttpStatus.OK)
  async drop(@Param("id", ParseUUIDPipe) id: string): Promise<TaskResponse> {
    return toTaskResponse(await this.tasks.drop(id));
  }
}
