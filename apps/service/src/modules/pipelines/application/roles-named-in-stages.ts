import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PipelineRoleSources, type PipelineRolesNamed } from "../../people/index.js";
import { rolesNamedByOpenTasks } from "../domain/task-stages.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";

/**
 * Tells People's capability check which Roles Agent Stages name (spec §5.4): the library's, run in
 * any Project, and open Tasks' own Stages', each run only in its Task's Project.
 */
@Injectable()
export class RolesNamedInStages implements OnModuleInit {
  constructor(
    private readonly library: PipelineLibrary,
    private readonly taskStages: TaskStagesRepository,
    private readonly tasks: StartedTasks,
    private readonly sources: PipelineRoleSources,
  ) {}

  onModuleInit(): void {
    this.sources.register(() => this.rolesNamed());
  }

  async rolesNamed(): Promise<PipelineRolesNamed> {
    const [everywhere, taskStages, tasks] = await Promise.all([
      this.library.rolesNamed(),
      this.taskStages.list(),
      this.tasks.list(),
    ]);
    return { everywhere, byProject: rolesNamedByOpenTasks(taskStages, tasks) };
  }
}
