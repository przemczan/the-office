import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PipelineRoleSources, type PipelineRolesNamed } from "../../people/index.js";
import { NO_STAGE_WORKERS, type StageWorkers } from "../domain/stage.js";
import { rolesNamedByOpenTasks } from "../domain/task-stages.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";

/**
 * Tells People's capability check which Roles Agent Stages name (spec §5.4): the office-wide
 * Pipelines', run in any Project; and open Tasks' own Stages' and Project Pipelines' built Stages',
 * each run only in its Project. People merges the two sources.
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
    this.sources.register(() => this.rolesNamedByProjectPipelines());
  }

  async rolesNamed(): Promise<PipelineRolesNamed> {
    const [everywhere, taskStages, tasks] = await Promise.all([
      this.library.rolesNamed(),
      this.taskStages.list(),
      this.tasks.list(),
    ]);
    return rolesNamedOf(everywhere, rolesNamedByOpenTasks(taskStages, tasks));
  }

  async rolesNamedByProjectPipelines(): Promise<PipelineRolesNamed> {
    return rolesNamedOf(NO_STAGE_WORKERS, await this.library.rolesNamedByProject());
  }
}

/** People's shape of who Stages name: Roles and duties apart, each where their sessions run. */
function rolesNamedOf(
  everywhere: StageWorkers,
  byProject: ReadonlyMap<string, StageWorkers>,
): PipelineRolesNamed {
  const projects = [...byProject];
  return {
    everywhere: everywhere.roles,
    byProject: new Map(projects.map(([projectId, { roles }]) => [projectId, roles])),
    duties: {
      everywhere: everywhere.duties,
      byProject: new Map(projects.map(([projectId, { duties }]) => [projectId, duties])),
    },
  };
}
