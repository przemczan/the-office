import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from "@nestjs/common";
import { taskEngineCascadeSchema, type TaskEngineCascade } from "@the-office/contracts";
import { TaskRoleEngines } from "../../application/task-role-engines.js";

/**
 * What the Task page's Engine block lists: the engine each person working on the Task lands on,
 * the model and effort they work with there, and the Stages that set their own effort.
 */
@Controller("tasks")
export class TaskEngineCascadeController {
  constructor(private readonly taskRoleEngines: TaskRoleEngines) {}

  @Get(":id/engine-cascade")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskEngineCascade> {
    const people = await this.taskRoleEngines.of(id);
    if (people === undefined) throw new NotFoundException(`There is no Task "${id}".`);
    return taskEngineCascadeSchema.parse({ people });
  }
}
