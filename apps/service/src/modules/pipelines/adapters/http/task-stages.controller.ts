import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import type { TaskStages as TaskStagesResponse } from "@the-office/contracts";
import { TaskStagesService } from "../../application/task-stages-service.js";
import { toTaskStageResponse } from "./pipeline-responses.js";

/** A started Task's own Stages with their runs, for the Task page's Stages block. */
@Controller("tasks")
export class TaskStagesController {
  constructor(private readonly taskStages: TaskStagesService) {}

  @Get(":id/stages")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskStagesResponse> {
    const progress = await this.taskStages.progress(id);
    return { stages: progress?.map(toTaskStageResponse) ?? null };
  }
}
