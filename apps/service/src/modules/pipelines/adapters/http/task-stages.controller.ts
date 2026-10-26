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
  taskStagesEditSchema,
  type StagesCheck,
  type TaskStagesEdit,
  type TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
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

  /** Edit for this Task: the Task's Stages replaced, the library Pipeline left as it is. */
  @Put(":id/stages")
  @UseFilters(StagesEditRefusalsFilter)
  async edit(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskStagesEditSchema)) { stages }: TaskStagesEdit,
  ): Promise<TaskStagesResponse> {
    return toTaskStagesResponse(await this.taskStages.edit(id, stages));
  }

  /** What saving the edited Stages would be refused for; it saves nothing. */
  @Post(":id/stages/check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(taskStagesEditSchema)) { stages }: TaskStagesEdit,
  ): Promise<StagesCheck> {
    const problems = await this.taskStages.check(id, stages);
    return { problems: problems.map(toStageProblemResponse) };
  }
}
