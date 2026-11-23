import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  stagesCheckRequestSchema,
  taskStagesEditSchema,
  type StageRunCommandOutputs,
  type StagesCheck,
  type StagesCheckRequest,
  type TaskStagesEdit,
  type TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { withGivenLimits } from "../../domain/flow.js";
import { TaskStagesService } from "../../application/task-stages-service.js";
import { toStageProblemResponse, toTaskStagesResponse } from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/** A Task's own Stages with their runs, for the Task page's Stages block and its editor. */
@Controller("tasks")
export class TaskStagesController {
  constructor(private readonly taskStages: TaskStagesService) {}

  @Get(":id/stages")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.taskStages.progress(id));
  }

  /** What a run's commands printed, for the Stage history; apart from the Stages, read often. */
  @Get(":id/stage-runs/:runId/command-outputs")
  async commandOutputs(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("runId", ParseUUIDPipe) runId: string,
  ): Promise<StageRunCommandOutputs> {
    const outputs = await this.taskStages.commandOutputs(id, runId);
    if (!outputs) throw new NotFoundException(`The Task has no Stage run "${runId}".`);
    return { outputs: [...outputs] };
  }

  /** Edit for this Task: the Task's Stages replaced, the library Pipeline left as it is. */
  @Put(":id/stages")
  @UseFilters(StagesEditRefusalsFilter)
  async edit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskStagesEditSchema)) { stages }: TaskStagesEdit,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.taskStages.edit(id, withGivenLimits(stages)));
  }

  /**
   * What saving the edited Stages would be refused for, as if the Task followed `pipelineId` when it
   * is given; it saves nothing.
   */
  @Post(":id/stages/check")
  @HttpCode(HttpStatus.OK)
  @UseFilters(StagesEditRefusalsFilter)
  async check(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(stagesCheckRequestSchema)) { stages, pipelineId }: StagesCheckRequest,
  ): Promise<StagesCheck> {
    const problems = await this.taskStages.check(id, withGivenLimits(stages), pipelineId);
    return { problems: problems.map(toStageProblemResponse) };
  }
}
