import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from "@nestjs/common";
import { taskEngineCascadeSchema, type TaskEngineCascade } from "@the-office/contracts";
import { TaskRoleEngines } from "../../application/task-role-engines.js";

/**
 * What the Task page's Engine block lists: the one engine the Task's sessions run on, the model and
 * effort each person working on it works with there, and the Stages that set their own effort.
 */
@Controller("tasks")
export class TaskEngineCascadeController {
  constructor(private readonly taskRoleEngines: TaskRoleEngines) {}

  @Get(":id/engine-cascade")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskEngineCascade> {
    const engines = await this.taskRoleEngines.of(id);
    if (engines === undefined) throw new NotFoundException(`There is no Task "${id}".`);
    return taskEngineCascadeSchema.parse(engines);
  }
}
