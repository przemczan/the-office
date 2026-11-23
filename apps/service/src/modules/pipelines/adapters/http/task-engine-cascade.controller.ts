import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from "@nestjs/common";
import {
  taskEngineCascadeSchema,
  type StandInsApplying,
  type TaskEngineCascade,
} from "@the-office/contracts";
import { TaskRoleEngines } from "../../application/task-role-engines.js";

/**
 * While no engine is listed, no Stand-in Engine is either: a list names only engines listed, and
 * outside an engine the Office's is the one that would apply.
 */
const NO_STAND_INS: StandInsApplying = { from: "office", engineIds: [] };

/**
 * What the Task page's Engine block lists: the one engine the Task's sessions run on, whose
 * Stand-in Engine list applies there, the model and effort each person working on it works with
 * there, and the Stages that set their own effort.
 */
@Controller("tasks")
export class TaskEngineCascadeController {
  constructor(private readonly taskRoleEngines: TaskRoleEngines) {}

  @Get(":id/engine-cascade")
  async read(@Param("id", ParseUUIDPipe) id: string): Promise<TaskEngineCascade> {
    const engines = await this.taskRoleEngines.of(id);
    if (engines === undefined) throw new NotFoundException(`There is no Task "${id}".`);
    const { engine, people } = engines;
    return taskEngineCascadeSchema.parse({
      engine,
      standIns: engine?.standIns ?? NO_STAND_INS,
      people,
    });
  }
}
