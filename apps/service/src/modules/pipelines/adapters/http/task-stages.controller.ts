import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseFilters } from "@nestjs/common";
import {
  taskStagesEditSchema,
  type TaskStagesEdit,
  type TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { TaskStagesService } from "../../application/task-stages-service.js";
import { toTaskStagesResponse } from "./pipeline-responses.js";
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
}
